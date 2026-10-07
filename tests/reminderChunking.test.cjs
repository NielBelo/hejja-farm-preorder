const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// A Cloudflare Free csomag 50 subrequest/futás korlátját szimuláljuk: minden
// adatbázis-lekérdezés, RPC-hívás és SMTP2GO-hívás egy-egy subrequest, és a
// futás (egy csomag) számlálója ennél nem mehet feljebb.
const SUBREQUEST_LIMIT = 50;

function load(relativePath, imports = {}) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (name) => {
        if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
        return imports[name];
    });
    return exports;
}

const countyGroups = load('../lib/countyGroups.ts');
const orderNotificationData = load('../lib/email/orderNotificationData.ts');
const realReminderData = load('../lib/email/reminderData.ts', {
    '@/lib/countyGroups': countyGroups,
    '@/lib/email/orderNotificationData': orderNotificationData,
});
const reminderRun = load('../lib/email/reminderRun.ts');
const staleness = load('../lib/email/reminderStaleness.ts');
const smtp2go = load('../lib/email/smtp2go.ts');

// n rendelés, mind küldhető (submitted, normál átvételi nap, nem Bács-Kiskun).
function makeWorld(n) {
    const world = { orders: [], profiles: [], season_parameters: [], targets: [] };
    world.season_parameters.push({
        id: 1,
        time_window_start: '2026-09-01',
        time_window_end: '2026-10-01',
        pickup_time_start: '08:00',
        pickup_time_end: '12:00',
        local_pickup_time_start: '09:00',
    });
    for (let id = 1; id <= n; id += 1) {
        world.orders.push({
            id,
            user_id: `u${id}`,
            season_parameter_id: 1,
            public_order_number: `HO-${id}`,
            pickup_days: { pickup_date: '2026-10-07' },
            current_version: {
                order_items: [{ quantity: 1, size_preference: null, note: null, products: { name: 'Tojás' }, packages: { name: 'Doboz' } }],
            },
        });
        world.profiles.push({
            id: `u${id}`,
            first_name: 'Anna',
            last_name: `Teszt${id}`,
            email: `c${id}@example.hu`,
            county: 'Csongrád-Csanád',
        });
        world.targets.push({ orderId: id, pickupDayId: 100 });
    }
    return world;
}

// Lekérdezésenként egy subrequestet számol; csak az "in" szűrést és a select-et
// támogatja, ami a kötegelt betöltőhöz kell.
function countingSupabase(world, counter) {
    return {
        from(table) {
            counter.n += 1;
            let rows = world[table] ?? [];
            const builder = {
                select() { return builder; },
                in(column, values) {
                    rows = rows.filter((row) => values.includes(row[column]));
                    return builder;
                },
                then(resolve, reject) {
                    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
                },
            };
            return builder;
        },
    };
}

// Egy teljes futás szimulációja. A store (claim/finalize állapot) és a world
// több futáson át megmarad, így a duplikációvédelem is tesztelhető.
// inject(chunk, attempt, chunkIndex) -> 'throw' | 'lost-response' | undefined
function runRun(world, store, inject = () => undefined) {
    const sent = [];
    const childCounts = [];
    const parent = { n: 0 };
    let current = { n: 0 };
    const chunkOrder = [];
    const attemptsByChunk = new Map();
    const nextRowId = () => {
        store.nextId = (store.nextId ?? 0) + 1;
        return store.nextId;
    };

    const mod = load('../lib/email/sendReminderEmail.ts', {
        'server-only': {},
        '@/lib/email/reminder': {
            buildReminderEmail: (data) => ({ subject: `S ${data.orderNumber}`, text: 't', html: 'h' }),
        },
        '@/lib/email/reminderData': {
            getReminderOrderTargetsForDate: async () => {
                parent.n += 1;
                return world.targets;
            },
            loadReminderOrdersBatch: realReminderData.loadReminderOrdersBatch,
        },
        '@/lib/countyGroups': countyGroups,
        '@/lib/email/smtp2go': {
            isSmtp2GoUncertainError: smtp2go.isSmtp2GoUncertainError,
            sendSmtp2GoEmail: async (args) => {
                current.n += 1;
                sent.push(args.to);
                return { id: `m-${args.to}` };
            },
        },
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => false },
        '@/lib/email/reminderStaleness': staleness,
        '@/lib/email/reminderSends': {
            claimReminderSend: async (_sb, orderId, pickupDayId) => {
                current.n += 1;
                const key = `${orderId}:${pickupDayId}`;
                store.rows = store.rows ?? new Map();
                const row = store.rows.get(key) ?? { id: nextRowId(), status: 'pending', attemptedAt: null };
                store.rows.set(key, row);
                if (row.status === 'sent' || row.status === 'sending') {
                    return { id: row.id, claimed: false, status: row.status, attemptedAt: row.attemptedAt };
                }
                row.status = 'sending';
                row.attemptedAt = new Date().toISOString();
                return { id: row.id, claimed: true, status: 'sending', attemptedAt: row.attemptedAt };
            },
            finalizeReminderSend: async (_sb, id, outcome) => {
                current.n += 1;
                for (const row of store.rows.values()) {
                    if (row.id === id && row.status === 'sending') {
                        row.status = outcome.status;
                    }
                }
            },
        },
        '@/lib/email/reminderRun': reminderRun,
        '@/lib/email/adminReminderSummary': {
            sendAdminReminderSummary: async () => { throw new Error('admin summary must stay disabled'); },
        },
    });

    const runChunk = async (chunk, runAt) => {
        const key = chunk.map((t) => t.orderId).join(',');
        if (!chunkOrder.includes(key)) chunkOrder.push(key);
        const index = chunkOrder.indexOf(key);
        const attempt = (attemptsByChunk.get(key) ?? 0) + 1;
        attemptsByChunk.set(key, attempt);
        parent.n += 1; // egy service-binding hívás a szülő worker subrequestje

        const mode = inject(chunk, attempt, index);
        if (mode === 'throw') throw new Error('simulated worker failure');

        current = { n: 0 };
        const outcomes = await mod.processReminderChunk(countingSupabase(world, current), chunk, runAt);
        childCounts.push(current.n);

        if (mode === 'lost-response') throw new Error('simulated lost response after processing');
        return outcomes;
    };

    return mod.sendPickupReminders(countingSupabase(world, parent), '2026-10-07', runChunk).then((result) => ({
        result,
        sent,
        childCounts,
        parentCount: parent.n,
    }));
}

for (const n of [5, 25, 50, 100]) {
    test(`${n} rendelés: minden kiküldődik, duplikáció nincs, egyik futás sem lépi túl az 50 subrequestet`, async () => {
        const world = makeWorld(n);
        const store = {};
        const run = await runRun(world, store);

        assert.equal(run.result.stats.eligibleCount, n);
        assert.equal(run.result.stats.sentCount, n);
        assert.equal(run.result.stats.failedCount, 0);
        assert.equal(run.result.stats.uncertainCount, 0);
        assert.equal(run.sent.length, n, 'every order gets exactly one SMTP2GO call');
        assert.equal(new Set(run.sent).size, n, 'no recipient receives a duplicate');

        assert.ok(run.parentCount <= SUBREQUEST_LIMIT, `parent used ${run.parentCount} subrequests`);
        for (const count of run.childCounts) {
            assert.ok(count <= SUBREQUEST_LIMIT, `a chunk worker used ${count} subrequests`);
        }

        // Második futás ugyanarra a napra: a claim minden rekordot "sent"-nek lát.
        const again = await runRun(world, store);
        assert.equal(again.result.stats.sentCount, 0);
        assert.equal(again.result.stats.skippedCount, n);
        assert.equal(again.sent.length, 0, 'a second run must never re-send');
    });
}

test('100 rendelés: egy csomag legfeljebb 39 subrequestet használ (3 betöltés + 12 x 3 hívás)', async () => {
    const run = await runRun(makeWorld(100), {});
    assert.equal(Math.max(...run.childCounts), 39);
    assert.equal(run.childCounts.length, 9);
    assert.equal(run.parentCount, 10, '1 célpontlekérdezés + 9 csomaghívás');
});

test('átmeneti csomaghiba: az újrapróbálás után minden rendelés kimegy, duplikáció nélkül', async () => {
    const run = await runRun(makeWorld(25), {}, (chunk, attempt, index) => (index === 0 && attempt === 1 ? 'throw' : undefined));
    assert.equal(run.result.stats.sentCount, 25);
    assert.equal(run.result.uncertain.length, 0);
    assert.equal(new Set(run.sent).size, 25);
});

test('elveszett válasz: a csomag már elküldte a leveleket, az újrapróbálás NEM küldi újra', async () => {
    const run = await runRun(makeWorld(12), {}, (chunk, attempt) => (attempt === 1 ? 'lost-response' : undefined));
    assert.equal(run.sent.length, 12, 'the first attempt sent all 12 e-mails exactly once');
    assert.equal(new Set(run.sent).size, 12);
    assert.equal(run.result.stats.sentCount, 0, 'the retry sees them as already sent');
    assert.equal(run.result.stats.skippedCount, 12);
});

test('tartós csomaghiba: a hibás csomag rendelései láthatóan uncertain-ként jelennek meg, a többi kimegy', async () => {
    const run = await runRun(makeWorld(25), {}, (chunk, attempt, index) => (index === 1 ? 'throw' : undefined));
    assert.equal(run.result.stats.sentCount, 13);
    assert.equal(run.result.uncertain.length, 12, 'no silent loss: every order of the failed chunk is reported');
    assert.equal(run.sent.length, 13);
    assert.equal(new Set(run.sent).size, 13);
    for (const item of run.result.uncertain) {
        assert.match(item.detail, /Automatikus újraküldés NEM történt/);
    }
});

test('a kötegelt betöltés 3 lekérdezést használ, függetlenül a rendelések számától', async () => {
    const world = makeWorld(100);
    const counter = { n: 0 };
    const ids = world.targets.map((t) => t.orderId);
    const batch = await realReminderData.loadReminderOrdersBatch(countingSupabase(world, counter), ids);
    assert.equal(counter.n, 3);
    assert.equal(batch.size, 100);
    assert.equal(batch.get(7).recipient, 'c7@example.hu');
    assert.equal(batch.get(7).data.orderNumber, 'HO-7');
});

test('hiányos rendelésadat egy rendelést érint, a csomag többi része megy', async () => {
    const world = makeWorld(5);
    world.profiles = world.profiles.filter((p) => p.id !== 'u3');
    const run = await runRun(world, {});
    assert.equal(run.result.stats.sentCount, 4);
    assert.equal(run.result.stats.failedCount, 1);
    assert.equal(run.result.failures[0].orderId, 3);
    assert.equal(run.sent.includes('c3@example.hu'), false);
});
