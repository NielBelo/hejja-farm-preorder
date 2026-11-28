const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// BIZTONSÁG: ez a teszt SOHA nem érheti el az SMTP2GO-t. Az smtp2go modul
// teljesen le van cserélve, a küldő minden esetben hamis, és minden hívás
// naplózódik; a teszt végén ellenőrizzük, hogy a valódi küldő nem hívódott.
function load(relativePath, requireOverrides = {}) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (id) => {
        if (id in requireOverrides) return requireOverrides[id];
        if (id.startsWith('@/')) throw new Error(`Nincs felülírva: ${id}`);
        return require(id);
    });
    return exports;
}

class UncertainError extends Error {}
let realSmtpCalls = 0;
const smtp2go = {
    sendSmtp2GoEmail: async () => { realSmtpCalls += 1; throw new Error('A VALÓDI küldő hívódott a tesztben!'); },
    isSmtp2GoUncertainError: (error) => error instanceof UncertainError,
};

const guard = load('../lib/email/seasonLaunchGuard.ts');
const sendingSwitch = load('../lib/email/sendingSwitch.ts');
const switchMod = load('../lib/email/seasonLaunchSwitch.ts', { '@/lib/email/sendingSwitch': sendingSwitch });
const reminderSwitch = load('../lib/email/reminderSwitch.ts', { '@/lib/email/sendingSwitch': sendingSwitch });
const sends = load('../lib/email/seasonLaunchSends.ts');
const staleness = load('../lib/email/reminderStaleness.ts');
const runHelpers = load('../lib/email/reminderRun.ts');
const orderWindow = load('../lib/orderWindow.ts', {});
const mod = load('../lib/email/sendSeasonLaunch.ts', {
    '@/lib/email/seasonLaunch': {
        buildSeasonLaunchEmail: (season) => ({ subject: `S ${season.year}`, text: 't', html: 'h' }),
    },
    '@/lib/email/smtp2go': smtp2go,
    '@/lib/email/seasonLaunchGuard': guard,
    '@/lib/email/seasonLaunchSends': sends,
    '@/lib/email/reminderStaleness': staleness,
    '@/lib/email/reminderRun': runHelpers,
    '@/lib/orderWindow': orderWindow,
});

// In-memory Supabase: a claim/finalize RPC-k a valódi SQL-függvények logikáját
// követik (UNIQUE szezon+user, csak pending/failed foglalható).
function makeSupabase({ seasons = [], profiles = [] } = {}) {
    const rows = new Map();
    let nextId = 0;
    return {
        rows,
        rpc(name, args) {
            if (name === 'claim_season_launch_send') {
                const key = `${args.p_season_parameter_id}:${args.p_user_id}`;
                let row = rows.get(key);
                if (!row) {
                    row = { id: ++nextId, status: 'pending', attempted_at: null };
                    rows.set(key, row);
                }
                if (row.status === 'pending' || row.status === 'failed') {
                    row.status = 'sending';
                    row.attempted_at = new Date().toISOString();
                    return Promise.resolve({ data: [{ id: row.id, claimed: true, status: 'sending', attempted_at: row.attempted_at }], error: null });
                }
                return Promise.resolve({ data: [{ id: row.id, claimed: false, status: row.status, attempted_at: row.attempted_at }], error: null });
            }
            if (name === 'finalize_season_launch_send') {
                for (const row of rows.values()) {
                    if (row.id === args.p_id && row.status === 'sending') row.status = args.p_status;
                }
                return Promise.resolve({ data: null, error: null });
            }
            throw new Error(`Ismeretlen RPC: ${name}`);
        },
        from(table) {
            let data = table === 'season_parameters' ? seasons : profiles;
            const builder = {
                select() { return builder; },
                is() { return builder; },
                eq(column, value) { data = data.filter((row) => row[column] === value); return builder; },
                not() { return builder; },
                gte() { return builder; },
                lte() { return builder; },
                order() { return builder; },
                range(from, to) { data = data.slice(from, to + 1); return builder; },
                then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
            };
            return builder;
        },
    };
}

const season = { id: 7, year: 2026, season: 'Ősz', orderStart: '2026-10-06T00:00:00+02:00', orderEnd: '2026-11-30T23:59:00+01:00' };
const recipients = [
    { userId: 'u1', email: 'a@example.hu' },
    { userId: 'u2', email: 'b@example.hu' },
    { userId: 'u3', email: 'c@example.hu' },
];

let env;
beforeEach(() => {
    env = { ...process.env };
    delete process.env.SEASON_LAUNCH_TEST_RECIPIENT;
});
afterEach(() => {
    process.env = env;
    assert.equal(realSmtpCalls, 0, 'a valódi SMTP2GO küldő nem hívódhat a tesztben');
});

function fakeSender() {
    const sent = [];
    return { sent, send: async ({ to }) => { sent.push(to); return { id: `m-${to}` }; } };
}

test('a guard alapból blokkol: nincs claim, nincs küldés, nincs DB-lekérdezés', async () => {
    const supabase = makeSupabase();
    const result = await mod.sendSeasonLaunchEmails(supabase, '2026-10-06');
    assert.equal(result.blocked, true);
    assert.equal(supabase.rows.size, 0);

    const outcomes = await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date());
    assert.deepEqual(outcomes, [{ kind: 'skipped' }, { kind: 'skipped' }, { kind: 'skipped' }]);
    assert.equal(supabase.rows.size, 0);
});

test('a guard NODE_ENV=production nélkül is blokkol, bekapcsolt kapcsolóval is', () => {
    process.env.NODE_ENV = 'development';
    assert.equal(guard.isSeasonLaunchSendingBlocked(true), true);
    process.env.NODE_ENV = 'production';
    assert.equal(guard.isSeasonLaunchSendingBlocked(true), false);
    assert.equal(guard.isSeasonLaunchSendingBlocked(false), true);
    // Csak a pontos true nyit: semmi más érték nem.
    assert.equal(guard.isSeasonLaunchSendingBlocked(undefined), true);
    assert.equal(guard.isSeasonLaunchSendingBlocked('true'), true);
    // Az emlékeztető kapcsolója NEM nyitja ki a szezonlevelet.
    process.env.REMINDER_EMAIL_SENDING_ENABLED = 'true';
    assert.equal(guard.isSeasonLaunchSendingBlocked(false), true);
});

test('production + kikapcsolt kapcsoló: a küldő útvonal nem küld, nem foglal, nem kérdez', async () => {
    process.env.NODE_ENV = 'production';
    const supabase = makeSupabase();
    const result = await mod.sendSeasonLaunchEmails(supabase, '2026-10-06');
    assert.equal(result.blocked, true);
    const off = await mod.sendSeasonLaunchEmails(supabase, '2026-10-06', undefined, { sendingEnabled: false });
    assert.equal(off.blocked, true);
    const outcomes = await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { sendingEnabled: false });
    assert.deepEqual(outcomes.map((o) => o.kind), ['skipped', 'skipped', 'skipped']);
    assert.equal(supabase.rows.size, 0);
});

test('kapcsoló (KV): alapból kikapcsolt, hiba esetén is kikapcsolt, csak a pontos true kapcsol be', async () => {
    const kvOf = (value) => ({ get: async () => value, put: async () => {} });
    assert.equal((await switchMod.readSeasonLaunchSwitch(undefined)).enabled, false);
    assert.equal((await switchMod.readSeasonLaunchSwitch(kvOf(null))).enabled, false);
    assert.equal((await switchMod.readSeasonLaunchSwitch(kvOf('nem json'))).enabled, false);
    assert.equal((await switchMod.readSeasonLaunchSwitch(kvOf('{"enabled":"true"}'))).enabled, false);
    assert.equal((await switchMod.readSeasonLaunchSwitch(kvOf('{"enabled":1}'))).enabled, false);
    const throwing = { get: async () => { throw new Error('KV down'); }, put: async () => {} };
    assert.equal((await switchMod.readSeasonLaunchSwitch(throwing)).enabled, false);
    assert.equal((await switchMod.readSeasonLaunchSwitch(kvOf('{"enabled":true,"updatedAt":"2026-11-28T10:00:00.000Z","updatedBy":"a@b.hu"}'))).enabled, true);
});

test('kapcsoló (KV): írás-olvasás körút, hibás/hiányzó KV esetén null', async () => {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    const on = await switchMod.writeSeasonLaunchSwitch(kv, true, 'admin@example.hu', new Date('2026-11-28T10:00:00Z'));
    assert.deepEqual(on, { enabled: true, updatedAt: '2026-11-28T10:00:00.000Z', updatedBy: 'admin@example.hu' });
    assert.equal((await switchMod.readSeasonLaunchSwitch(kv)).enabled, true);
    await switchMod.writeSeasonLaunchSwitch(kv, false, 'admin@example.hu');
    assert.equal((await switchMod.readSeasonLaunchSwitch(kv)).enabled, false);
    assert.equal(await switchMod.writeSeasonLaunchSwitch(null, true, 'x'), null);
    const failing = { get: async () => null, put: async () => { throw new Error('KV down'); } };
    assert.equal(await switchMod.writeSeasonLaunchSwitch(failing, true, 'x'), null);
});

test('hamis küldővel mindenki pontosan egyszer kap levelet, második futás kihagy', async () => {
    const supabase = makeSupabase();
    const { sent, send } = fakeSender();
    const first = await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { send });
    assert.equal(first.filter((o) => o.kind === 'sent').length, 3);
    const second = await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { send });
    assert.equal(second.filter((o) => o.kind === 'skipped').length, 3);
    assert.deepEqual(sent.sort(), ['a@example.hu', 'b@example.hu', 'c@example.hu']);
});

test('teszt-címzett szűkítés: csak az az egy cím kap levelet', async () => {
    process.env.SEASON_LAUNCH_TEST_RECIPIENT = ' B@Example.hu ';
    const supabase = makeSupabase();
    const { sent, send } = fakeSender();
    await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { send });
    assert.deepEqual(sent, ['b@example.hu']);
    assert.equal(supabase.rows.size, 1);
});

test('több teszt-címzett: pontosan a felsoroltak kapnak, mindenki más nem', async () => {
    process.env.SEASON_LAUNCH_TEST_RECIPIENT = 'A@example.hu; c@example.hu';
    const supabase = makeSupabase();
    const { sent, send } = fakeSender();
    await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { send });
    assert.deepEqual(sent.sort(), ['a@example.hu', 'c@example.hu']);
    assert.equal(supabase.rows.size, 2);
});

test('érvénytelen teszt-címzett érték (pl. ",") senkinek sem küld, nem szélesít', async () => {
    for (const bad of [',', ' ; ', 'nem-cim']) {
        process.env.SEASON_LAUNCH_TEST_RECIPIENT = bad;
        const supabase = makeSupabase();
        const { sent, send } = fakeSender();
        await mod.processSeasonLaunchChunk(supabase, season, recipients, new Date(), { send });
        assert.deepEqual(sent, [], `"${bad}" esetén nem mehet levél`);
        assert.equal(supabase.rows.size, 0);
    }
});

test('egyértelmű elutasítás: failed, a következő futás újrapróbálja', async () => {
    const supabase = makeSupabase();
    let calls = 0;
    const send = async () => { calls += 1; if (calls === 1) throw new Error('elutasítva'); return { id: 'ok' }; };
    const first = await mod.processSeasonLaunchChunk(supabase, season, [recipients[0]], new Date(), { send });
    assert.equal(first[0].kind, 'failed');
    const second = await mod.processSeasonLaunchChunk(supabase, season, [recipients[0]], new Date(), { send });
    assert.equal(second[0].kind, 'sent');
});

test('bizonytalan SMTP-válasz: uncertain, sending marad, NEM küldi újra', async () => {
    const supabase = makeSupabase();
    let calls = 0;
    const send = async () => { calls += 1; throw new UncertainError('timeout'); };
    const first = await mod.processSeasonLaunchChunk(supabase, season, [recipients[0]], new Date(), { send });
    assert.equal(first[0].kind, 'uncertain');
    const second = await mod.processSeasonLaunchChunk(supabase, season, [recipients[0]], new Date(), { send });
    assert.equal(second[0].kind, 'skipped');
    assert.equal(calls, 1);
});

test('szezon csak a kezdőnapján választódik ki, utólag nem', async () => {
    const rows = [{ id: 7, is_active: true, year: 2026, season: 'Ősz', time_window_start: '2026-10-05T22:00:00Z', time_window_end: '2026-11-30T22:59:00Z' }];
    const supabase = makeSupabase({ seasons: rows });
    const now = new Date('2026-10-06T06:00:00Z');
    const onDay = await mod.getSeasonsStartingOn(supabase, '2026-10-06', now);
    assert.deepEqual(onDay.map((s) => s.id), [7]);
    const dayAfter = await mod.getSeasonsStartingOn(supabase, '2026-10-07', new Date('2026-10-07T06:00:00Z'));
    assert.deepEqual(dayAfter, []);
    const ended = await mod.getSeasonsStartingOn(supabase, '2026-10-06', new Date('2026-12-01T00:00:00Z'));
    assert.deepEqual(ended, []);
});

test('teljes futás: csomagolás, összesítés, üres címek kihagyva', async () => {
    const rows = [{ id: 7, is_active: true, year: 2026, season: 'Ősz', time_window_start: '2026-10-05T22:00:00Z', time_window_end: '2026-11-30T22:59:00Z' }];
    const profiles = Array.from({ length: 40 }, (_, i) => ({ id: `u${i}`, email: i === 5 ? '  ' : `c${i}@example.hu` }));
    const supabase = makeSupabase({ seasons: rows, profiles });
    const { sent, send } = fakeSender();
    const result = await mod.sendSeasonLaunchEmails(supabase, '2026-10-06', undefined, { send });
    assert.equal(result.recipientCount, 39);
    assert.equal(result.sentCount, 39);
    assert.equal(sent.length, 39);
    // Második futás: semmi nem megy ki újra.
    const again = await mod.sendSeasonLaunchEmails(supabase, '2026-10-06', undefined, { send });
    assert.equal(again.sentCount, 0);
    assert.equal(again.skippedCount, 39);
    assert.equal(sent.length, 39);
});

test('egy csomag költségvetése: címzettenként 3 hívás, legfeljebb 25 subrequest (a 50-es keret fele)', () => {
    assert.ok(mod.SEASON_LAUNCH_CHUNK_SIZE * 3 <= 25);
});

test('emlékeztető kapcsoló: KV-érték nélkül a régi env beállítás érvényes, KV-értékkel a KV dönt', async () => {
    const empty = { get: async () => null, put: async () => {} };
    assert.equal((await reminderSwitch.resolveReminderSending(empty, 'true')).state.enabled, true);
    assert.equal((await reminderSwitch.resolveReminderSending(empty, 'true')).inheritedFromEnv, true);
    assert.equal((await reminderSwitch.resolveReminderSending(empty, undefined)).state.enabled, false);
    assert.equal((await reminderSwitch.resolveReminderSending(empty, 'false')).state.enabled, false);

    const off = { get: async () => '{"enabled":false}', put: async () => {} };
    const resolvedOff = await reminderSwitch.resolveReminderSending(off, 'true');
    assert.equal(resolvedOff.state.enabled, false, 'a KV-ban mentett kikapcsolás felülírja a régi env-et');
    assert.equal(resolvedOff.inheritedFromEnv, false);

    const on = { get: async () => '{"enabled":true}', put: async () => {} };
    assert.equal((await reminderSwitch.resolveReminderSending(on, undefined)).state.enabled, true);
});

test('emlékeztető kapcsoló: elérhetetlen KV esetén KIKAPCSOLT még bekapcsolt régi env mellett is', async () => {
    const throwing = { get: async () => { throw new Error('KV down'); }, put: async () => {} };
    assert.equal((await reminderSwitch.resolveReminderSending(throwing, 'true')).state.enabled, false);
    assert.equal((await reminderSwitch.resolveReminderSending(undefined, 'true')).state.enabled, false);
});

test('emlékeztető kapcsoló: az env-be íródó érték a feloldott állapotot követi', async () => {
    process.env.REMINDER_EMAIL_SENDING_ENABLED = 'true';
    const off = { get: async () => '{"enabled":false}', put: async () => {} };
    assert.equal(await reminderSwitch.applyReminderSwitchToEnv(off), false);
    assert.equal(process.env.REMINDER_EMAIL_SENDING_ENABLED, 'false');
    const on = { get: async () => '{"enabled":true}', put: async () => {} };
    assert.equal(await reminderSwitch.applyReminderSwitchToEnv(on), true);
    assert.equal(process.env.REMINDER_EMAIL_SENDING_ENABLED, 'true');
    assert.equal(await reminderSwitch.applyReminderSwitchToEnv(undefined), false);
    assert.equal(process.env.REMINDER_EMAIL_SENDING_ENABLED, 'false');
});

test('emlékeztető és szezonértesítő kapcsoló külön kulcson él', async () => {
    const store = new Map();
    const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
    await reminderSwitch.writeReminderSwitch(kv, true, 'a@b.hu');
    assert.equal((await switchMod.readSeasonLaunchSwitch(kv)).enabled, false);
    assert.equal((await reminderSwitch.resolveReminderSending(kv, undefined)).state.enabled, true);
    assert.notEqual(switchMod.SEASON_LAUNCH_SWITCH_KEY, reminderSwitch.REMINDER_SWITCH_KEY);
});

test('csak az aktív szezon indít értesítőt: az inaktív kezdőnapon sem', async () => {
    const base = { year: 2026, season: 'Ősz', time_window_start: '2026-10-05T22:00:00Z', time_window_end: '2026-11-30T22:59:00Z' };
    const supabase = makeSupabase({ seasons: [{ id: 7, is_active: false, ...base }, { id: 8, is_active: true, ...base }] });
    const now = new Date('2026-10-06T06:00:00Z');
    const picked = await mod.getSeasonsStartingOn(supabase, '2026-10-06', now);
    assert.deepEqual(picked.map((season) => season.id), [8]);

    const onlyInactive = makeSupabase({ seasons: [{ id: 7, is_active: false, ...base }] });
    assert.deepEqual(await mod.getSeasonsStartingOn(onlyInactive, '2026-10-06', now), []);
});
