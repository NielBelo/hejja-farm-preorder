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
    delete process.env.SEASON_LAUNCH_EMAIL_SENDING_ENABLED;
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

test('a guard NODE_ENV=production nélkül is blokkol, flaggel is', () => {
    process.env.SEASON_LAUNCH_EMAIL_SENDING_ENABLED = 'true';
    process.env.NODE_ENV = 'development';
    assert.equal(guard.isSeasonLaunchSendingBlocked(), true);
    process.env.NODE_ENV = 'production';
    assert.equal(guard.isSeasonLaunchSendingBlocked(), false);
    delete process.env.SEASON_LAUNCH_EMAIL_SENDING_ENABLED;
    assert.equal(guard.isSeasonLaunchSendingBlocked(), true);
    // Az emlékeztető kapcsolója NEM nyitja ki a szezonlevelet.
    process.env.REMINDER_EMAIL_SENDING_ENABLED = 'true';
    assert.equal(guard.isSeasonLaunchSendingBlocked(), true);
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
    const rows = [{ id: 7, year: 2026, season: 'Ősz', time_window_start: '2026-10-05T22:00:00Z', time_window_end: '2026-11-30T22:59:00Z' }];
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
    const rows = [{ id: 7, year: 2026, season: 'Ősz', time_window_start: '2026-10-05T22:00:00Z', time_window_end: '2026-11-30T22:59:00Z' }];
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
