const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

const { isBacsKiskunCounty } = load('../lib/countyGroups.ts');
const { summarizeReminderOutcomes, shouldSendAdminReminderSummary, processWithConcurrencyLimit } = load('../lib/email/reminderRun.ts');
const reminderStalenessModule = load('../lib/email/reminderStaleness.ts');

// Hűen szimulálja a public.claim_reminder_send / finalize_reminder_send
// Postgres-függvények (supabase/migrations/20260930000000_reminder_sends.sql
// és 20260930010000_reminder_sends_claim_attempted_at.sql) atomicitását: két
// egyidejű claim() hívás ugyanarra a kulcsra a Postgres sorszintű
// UPDATE-zárolásának megfelelően SOROSAN fut le (withLock), így közülük csak
// az egyik kaphat claimed=true-t - docker/local Postgres nélkül ez a
// legjobb elérhető módja a konkurenciavédelem tesztelésének ebben a
// környezetben (lásd a végső jelentés pontjait: a migrációk SQL-je maga nem
// futtatható itt, csak manuálisan átnézett).
function createMockReminderStore() {
    const rows = new Map(); // key -> { id, status, attemptedAt, sentAt, errorMessage, providerMessageId }
    const locks = new Map(); // key -> promise chain, a Postgres sorzárolását szimulálja
    let nextId = 1;
    const claimCalls = [];
    const finalizeCalls = [];

    function withLock(key, fn) {
        const prior = locks.get(key) ?? Promise.resolve();
        const next = prior.then(fn, fn);
        locks.set(key, next.catch(() => {}));
        return next;
    }

    return {
        claimCalls,
        finalizeCalls,
        getRow(orderId, pickupDayId) {
            return rows.get(`${orderId}:${pickupDayId}`);
        },
        // Teszt-segéd a worker-crash forgatókönyvhöz: egy sort közvetlenül
        // "sending" állapotúra állít egy megadott (jellemzően múltbeli)
        // attempted_at-tel, finalize hívása NÉLKÜL - pontosan azt
        // szimulálja, amikor a claim megtörtént, de a worker összeomlott/
        // timeoutolt, mielőtt finalize_reminder_send lefuthatott volna.
        seedSending(orderId, pickupDayId, attemptedAtIso) {
            const key = `${orderId}:${pickupDayId}`;
            const row = { id: nextId++, status: 'sending', attemptedAt: attemptedAtIso };
            rows.set(key, row);
            return row;
        },
        async claim(orderId, pickupDayId) {
            claimCalls.push({ orderId, pickupDayId });
            const key = `${orderId}:${pickupDayId}`;
            return withLock(key, async () => {
                let row = rows.get(key);
                if (!row) {
                    row = { id: nextId++, status: 'pending', attemptedAt: null };
                    rows.set(key, row);
                }
                if (row.status === 'sent' || row.status === 'sending') {
                    return { id: row.id, claimed: false, status: row.status, attemptedAt: row.attemptedAt };
                }
                // 'pending' vagy 'failed' -> lefoglalható (retry engedett)
                row.status = 'sending';
                row.attemptedAt = new Date().toISOString();
                return { id: row.id, claimed: true, status: 'sending', attemptedAt: row.attemptedAt };
            });
        },
        async finalize(id, status, extra) {
            finalizeCalls.push({ id, status, extra });
            for (const row of rows.values()) {
                if (row.id === id) {
                    if (row.status !== 'sending') return; // ugyanaz a védelem, mint az SQL-ben
                    row.status = status;
                    Object.assign(row, extra);
                    return;
                }
            }
        },
    };
}

// A sendOutcomeByRecipient Map kulcsa a "to" címzett e-mail; értéke egy
// sikeres küldésnél a provider message id (string), sikertelennél egy Error.
function buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, blocked = false, store }) {
    const smtp2goCalls = [];
    const adminSummaryCalls = [];

    const modules = load('../lib/email/sendReminderEmail.ts', {
        '@/lib/email/reminder': {
            buildReminderEmail: (data) => ({
                subject: `Emlékeztető (${data.orderNumber})`,
                text: `szöveg ${data.orderNumber}`,
                html: `<p>${data.orderNumber}</p>`,
            }),
        },
        '@/lib/email/reminderData': {
            getReminderOrderTargetsForDate: async () => targets,
        },
        '@/lib/email/orderNotificationData': {
            loadOrderNotificationData: async (_supabase, lookup) => {
                const info = orderData.get(lookup.orderId);
                if (!info) throw new Error(`no fixture data for order ${lookup.orderId}`);
                return {
                    recipient: info.recipient,
                    data: { orderId: lookup.orderId, orderNumber: info.orderNumber, county: info.county, items: [] },
                };
            },
        },
        '@/lib/countyGroups': { isBacsKiskunCounty },
        '@/lib/email/smtp2go': {
            sendSmtp2GoEmail: async (args) => {
                smtp2goCalls.push(args);
                const outcome = sendOutcomeByRecipient.get(args.to);
                if (outcome instanceof Error) throw outcome;
                return { id: outcome || 'fake-message-id' };
            },
        },
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => blocked },
        '@/lib/email/reminderStaleness': reminderStalenessModule,
        '@/lib/email/reminderSends': {
            claimReminderSend: (_supabase, orderId, pickupDayId) => store.claim(orderId, pickupDayId),
            finalizeReminderSend: (_supabase, id, outcome) => {
                if (outcome.status === 'sent') {
                    return store.finalize(id, 'sent', { sentAt: 'now', providerMessageId: outcome.providerMessageId });
                }
                return store.finalize(id, 'failed', { errorMessage: outcome.errorMessage });
            },
        },
        '@/lib/email/reminderRun': {
            processWithConcurrencyLimit,
            summarizeReminderOutcomes,
            shouldSendAdminReminderSummary,
        },
        '@/lib/email/adminReminderSummary': {
            sendAdminReminderSummary: async (input) => {
                adminSummaryCalls.push(input);
            },
        },
    });

    return { sendPickupReminders: modules.sendPickupReminders, store, adminSummaryCalls, smtp2goCalls };
}

const fakeSupabase = {};

// 1-2-3: első reminder küldhető, sikeres -> "sent", ugyanaz másodszor -> skip.
test('1-2-3: first attempt succeeds and becomes sent, a second run for the same order+day is skipped', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 1, pickupDayId: 100 }];
    const orderData = new Map([[1, { orderNumber: 'HO-0001', recipient: 'a@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx1 = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['a@example.hu', 'msg-1']]), store });
    const result1 = await fx1.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result1.stats.sentCount, 1);
    assert.equal(result1.stats.attemptedCount, 1);
    assert.equal(store.getRow(1, 100).status, 'sent');

    const fx2 = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['a@example.hu', 'msg-2']]), store });
    const result2 = await fx2.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result2.stats.sentCount, 0);
    assert.equal(result2.stats.skippedCount, 1);
    assert.equal(result2.stats.attemptedCount, 0);
    assert.equal(fx2.smtp2goCalls.length, 0, 'SMTP2GO must not be called again for an already-sent reminder');
});

// 4-5: failed reminder -> retry engedett, retry siker -> "sent".
test('4-5: a failed reminder can be retried, and a successful retry becomes sent', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 2, pickupDayId: 100 }];
    const orderData = new Map([[2, { orderNumber: 'HO-0002', recipient: 'b@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx1 = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['b@example.hu', new Error('SMTP2GO 500')]]), store });
    const result1 = await fx1.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result1.stats.failedCount, 1);
    assert.equal(store.getRow(2, 100).status, 'failed');

    const fx2 = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['b@example.hu', 'msg-retry']]), store });
    const result2 = await fx2.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result2.stats.sentCount, 1);
    assert.equal(store.getRow(2, 100).status, 'sent');
});

// 6-7: egy failed címzett után a következő feldolgozása folytatódik; több címzett kezelése.
test('6-7: one failing recipient does not stop the run; multiple recipients are all processed', async () => {
    const store = createMockReminderStore();
    const targets = [
        { orderId: 10, pickupDayId: 100 },
        { orderId: 11, pickupDayId: 100 },
        { orderId: 12, pickupDayId: 100 },
    ];
    const orderData = new Map([
        [10, { orderNumber: 'HO-0010', recipient: 'ok1@example.hu', county: 'Csongrád-Csanád' }],
        [11, { orderNumber: 'HO-0011', recipient: 'fail@example.hu', county: 'Csongrád-Csanád' }],
        [12, { orderNumber: 'HO-0012', recipient: 'ok2@example.hu', county: 'Békés' }],
    ]);
    const sendOutcomeByRecipient = new Map([
        ['ok1@example.hu', 'msg-10'],
        ['fail@example.hu', new Error('connection reset')],
        ['ok2@example.hu', 'msg-12'],
    ]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(result.stats.eligibleCount, 3);
    assert.equal(result.stats.attemptedCount, 3);
    assert.equal(result.stats.sentCount, 2);
    assert.equal(result.stats.failedCount, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].orderNumber, 'HO-0011');
    assert.equal(result.failures[0].recipient, 'fail@example.hu');
    assert.equal(fx.smtp2goCalls.length, 3, 'all three orders must have been attempted');
});

// 8: max. 5 párhuzamos feldolgozás.
test('8: at most 5 orders are processed concurrently even with many eligible orders', async () => {
    const store = createMockReminderStore();
    const targets = Array.from({ length: 17 }, (_, i) => ({ orderId: 100 + i, pickupDayId: 100 }));
    const orderData = new Map(targets.map((t) => [t.orderId, {
        orderNumber: `HO-0${t.orderId}`,
        recipient: `u${t.orderId}@example.hu`,
        county: 'Csongrád-Csanád',
    }]));
    const sendOutcomeByRecipient = new Map(targets.map((t) => [`u${t.orderId}@example.hu`, `msg-${t.orderId}`]));

    let inFlight = 0;
    let maxInFlight = 0;
    const smtp2goCalls = [];
    const modules = load('../lib/email/sendReminderEmail.ts', {
        '@/lib/email/reminder': { buildReminderEmail: (data) => ({ subject: 's', text: 't', html: 'h', orderNumber: data.orderNumber }) },
        '@/lib/email/reminderData': { getReminderOrderTargetsForDate: async () => targets },
        '@/lib/email/orderNotificationData': {
            loadOrderNotificationData: async (_supabase, lookup) => {
                const info = orderData.get(lookup.orderId);
                return { recipient: info.recipient, data: { orderId: lookup.orderId, orderNumber: info.orderNumber, county: info.county, items: [] } };
            },
        },
        '@/lib/countyGroups': { isBacsKiskunCounty },
        '@/lib/email/smtp2go': {
            sendSmtp2GoEmail: async (args) => {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                smtp2goCalls.push(args);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return { id: sendOutcomeByRecipient.get(args.to) };
            },
        },
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => false },
        '@/lib/email/reminderStaleness': reminderStalenessModule,
        '@/lib/email/reminderSends': {
            claimReminderSend: (_supabase, orderId, pickupDayId) => store.claim(orderId, pickupDayId),
            finalizeReminderSend: (_supabase, id, outcome) => store.finalize(id, outcome.status, outcome),
        },
        '@/lib/email/reminderRun': { processWithConcurrencyLimit, summarizeReminderOutcomes, shouldSendAdminReminderSummary },
        '@/lib/email/adminReminderSummary': { sendAdminReminderSummary: async () => {} },
    });

    const result = await modules.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result.stats.sentCount, 17);
    assert.ok(maxInFlight <= 5, `expected at most 5 concurrent SMTP2GO calls, saw ${maxInFlight}`);
    assert.equal(smtp2goCalls.length, 17);
});

// 9: két párhuzamos worker ugyanarra a reminderre -> nincs dupla sikeres küldés.
test('9: two concurrent "workers" racing the same order+pickup day never both succeed', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 50, pickupDayId: 100 }];
    const orderData = new Map([[50, { orderNumber: 'HO-0050', recipient: 'race@example.hu', county: 'Csongrád-Csanád' }]]);

    const fxA = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['race@example.hu', 'msg-a']]), store });
    const fxB = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['race@example.hu', 'msg-b']]), store });

    const [resultA, resultB] = await Promise.all([
        fxA.sendPickupReminders(fakeSupabase, '2026-10-07'),
        fxB.sendPickupReminders(fakeSupabase, '2026-10-07'),
    ]);

    const totalSent = resultA.stats.sentCount + resultB.stats.sentCount;
    const totalSkipped = resultA.stats.skippedCount + resultB.stats.skippedCount;
    assert.equal(totalSent, 1, 'exactly one of the two concurrent workers must have sent successfully');
    assert.equal(totalSkipped, 1, 'the other worker must have skipped, not attempted');
    assert.equal(store.getRow(50, 100).status, 'sent');
});

// 10-11: localhost guard miatt nincs SMTP2GO hívás, és nem keletkezik hamis "sent".
test('10-11: when the guard is blocked, zero SMTP2GO calls happen and no reminder is falsely marked sent', async () => {
    const store = createMockReminderStore();
    const targets = [
        { orderId: 60, pickupDayId: 100 },
        { orderId: 61, pickupDayId: 100 },
    ];
    const orderData = new Map([
        [60, { orderNumber: 'HO-0060', recipient: 'x@example.hu', county: 'Csongrád-Csanád' }],
        [61, { orderNumber: 'HO-0061', recipient: 'y@example.hu', county: 'Békés' }],
    ]);

    const fx = buildFixtureBySendOutcome({
        targets,
        orderData,
        sendOutcomeByRecipient: new Map([['x@example.hu', 'would-send'], ['y@example.hu', 'would-send']]),
        blocked: true,
        store,
    });

    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(fx.smtp2goCalls.length, 0);
    assert.equal(result.blocked, true);
    assert.equal(result.stats.eligibleCount, 2);
    assert.equal(result.stats.attemptedCount, 0);
    assert.equal(result.stats.sentCount, 0);
    assert.equal(store.claimCalls.length, 0, 'blocked runs must not even claim a reminder-sends row');
    assert.equal(store.getRow(60, 100), undefined);
    assert.equal(store.getRow(61, 100), undefined);
});

// 12-13: attemptedCount helyesen számol, skip nem számít attemptnek (vegyes futás).
test('12-13: attemptedCount counts sent+failed only, never skipped, in a mixed run', async () => {
    const store = createMockReminderStore();
    // Order 70 is pre-seeded as already "sent" by claiming+finalizing it first.
    await store.claim(70, 100);
    const preSeeded = store.getRow(70, 100);
    await store.finalize(preSeeded.id, 'sent', { sentAt: 'now' });

    const targets = [
        { orderId: 70, pickupDayId: 100 }, // already sent -> skip
        { orderId: 71, pickupDayId: 100 }, // new -> sent
        { orderId: 72, pickupDayId: 100 }, // new -> failed
    ];
    const orderData = new Map([
        [70, { orderNumber: 'HO-0070', recipient: 'p@example.hu', county: 'Csongrád-Csanád' }],
        [71, { orderNumber: 'HO-0071', recipient: 'q@example.hu', county: 'Csongrád-Csanád' }],
        [72, { orderNumber: 'HO-0072', recipient: 'r@example.hu', county: 'Csongrád-Csanád' }],
    ]);
    const sendOutcomeByRecipient = new Map([
        ['q@example.hu', 'msg-71'],
        ['r@example.hu', new Error('bounce')],
    ]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(result.stats.eligibleCount, 3);
    assert.equal(result.stats.skippedCount, 1);
    assert.equal(result.stats.sentCount, 1);
    assert.equal(result.stats.failedCount, 1);
    assert.equal(result.stats.attemptedCount, 2, 'the skipped order-70 must not be counted as an attempt');
});

// 14-15-16-17: admin összesítő feltétele.
test('14: attemptedCount = 0 (everything skipped) -> no admin summary is sent', async () => {
    const store = createMockReminderStore();
    await store.claim(80, 100);
    await store.finalize(store.getRow(80, 100).id, 'sent', {});
    const targets = [{ orderId: 80, pickupDayId: 100 }];
    const orderData = new Map([[80, { orderNumber: 'HO-0080', recipient: 'z@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map(), store });
    await fx.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(fx.adminSummaryCalls.length, 0);
});

test('14b: attemptedCount = 0 because zero eligible orders -> no admin summary', async () => {
    const store = createMockReminderStore();
    const fx = buildFixtureBySendOutcome({ targets: [], orderData: new Map(), sendOutcomeByRecipient: new Map(), store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result.stats.eligibleCount, 0);
    assert.equal(fx.adminSummaryCalls.length, 0);
});

test('15: attemptedCount >= 1 and every attempt succeeded -> exactly one admin summary', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 90, pickupDayId: 100 }, { orderId: 91, pickupDayId: 100 }];
    const orderData = new Map([
        [90, { orderNumber: 'HO-0090', recipient: 'a1@example.hu', county: 'Csongrád-Csanád' }],
        [91, { orderNumber: 'HO-0091', recipient: 'a2@example.hu', county: 'Csongrád-Csanád' }],
    ]);
    const sendOutcomeByRecipient = new Map([['a1@example.hu', 'm1'], ['a2@example.hu', 'm2']]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(fx.adminSummaryCalls.length, 1);
    assert.equal(fx.adminSummaryCalls[0].stats.attemptedCount, 2);
    assert.equal(result.stats.failedCount, 0);
});

test('16: attemptedCount >= 1 and every attempt failed -> exactly one admin summary', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 92, pickupDayId: 100 }];
    const orderData = new Map([[92, { orderNumber: 'HO-0092', recipient: 'f1@example.hu', county: 'Csongrád-Csanád' }]]);
    const sendOutcomeByRecipient = new Map([['f1@example.hu', new Error('down')]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    await fx.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(fx.adminSummaryCalls.length, 1);
    assert.equal(fx.adminSummaryCalls[0].stats.sentCount, 0);
    assert.equal(fx.adminSummaryCalls[0].stats.failedCount, 1);
});

test('17: mixed sent/failed run -> exactly one admin summary, with failures listed', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 93, pickupDayId: 100 }, { orderId: 94, pickupDayId: 100 }];
    const orderData = new Map([
        [93, { orderNumber: 'HO-0093', recipient: 'ok@example.hu', county: 'Csongrád-Csanád' }],
        [94, { orderNumber: 'HO-0094', recipient: 'bad@example.hu', county: 'Csongrád-Csanád' }],
    ]);
    const sendOutcomeByRecipient = new Map([['ok@example.hu', 'ok-msg'], ['bad@example.hu', new Error('rejected')]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    await fx.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(fx.adminSummaryCalls.length, 1);
    assert.equal(fx.adminSummaryCalls[0].failures.length, 1);
    assert.equal(fx.adminSummaryCalls[0].failures[0].orderNumber, 'HO-0094');
});

// 18: az admin összesítő küldésének hibája nem módosítja a reminder státuszokat.
test('18: a throwing admin-summary sender does not change the already-finalized reminder statuses or the run result', async () => {
    const store = createMockReminderStore();
    const targets = [{ orderId: 95, pickupDayId: 100 }];
    const orderData = new Map([[95, { orderNumber: 'HO-0095', recipient: 'ok2@example.hu', county: 'Csongrád-Csanád' }]]);

    const modules = load('../lib/email/sendReminderEmail.ts', {
        '@/lib/email/reminder': { buildReminderEmail: (data) => ({ subject: 's', text: 't', html: 'h', orderNumber: data.orderNumber }) },
        '@/lib/email/reminderData': { getReminderOrderTargetsForDate: async () => targets },
        '@/lib/email/orderNotificationData': {
            loadOrderNotificationData: async (_supabase, lookup) => {
                const info = orderData.get(lookup.orderId);
                return { recipient: info.recipient, data: { orderId: lookup.orderId, orderNumber: info.orderNumber, county: info.county, items: [] } };
            },
        },
        '@/lib/countyGroups': { isBacsKiskunCounty },
        '@/lib/email/smtp2go': { sendSmtp2GoEmail: async () => ({ id: 'ok-msg' }) },
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => false },
        '@/lib/email/reminderStaleness': reminderStalenessModule,
        '@/lib/email/reminderSends': {
            claimReminderSend: (_supabase, orderId, pickupDayId) => store.claim(orderId, pickupDayId),
            finalizeReminderSend: (_supabase, id, outcome) => store.finalize(id, outcome.status, outcome),
        },
        '@/lib/email/reminderRun': { processWithConcurrencyLimit, summarizeReminderOutcomes, shouldSendAdminReminderSummary },
        '@/lib/email/adminReminderSummary': {
            sendAdminReminderSummary: async () => { throw new Error('admin summary SMTP2GO down'); },
        },
    });

    // sendPickupReminders itself must not reject just because the admin
    // summary step throws - the customer-facing reminder result was already
    // computed and finalized before that step runs.
    const result = await modules.sendPickupReminders(fakeSupabase, '2026-10-07');
    assert.equal(result.stats.sentCount, 1);
    assert.equal(store.getRow(95, 100).status, 'sent');
});

// --- "sending" crash/recovery viselkedés ---
//
// A seedSending() teszt-segéd (lásd createMockReminderStore fent) pontosan
// azt a forgatókönyvet szimulálja, amit a feladat leír: egy korábbi claim
// megtörtént (a sor "sending" állapotba került, attempted_at rögzült), de a
// finalize_reminder_send SOHA nem futott le (worker crash/timeout a SMTP2GO-
// hívás után/közben). Az itt használt múltbeli attempted_at a VALÓS
// Date.now()-hoz képest lett kiszámolva (nem egy injektált "now"-hoz
// képest), mert sendPickupReminders maga dönti el az aktuális időt - ez
// tükrözi, hogy a valódi rendszerben is a tényleges falióraidő számít.

test('friss "sending" (nem stale): a claim skip-nek minősül, NEM uncertain, és nem küld SMTP2GO-t', async () => {
    const store = createMockReminderStore();
    const recentAttemptedAt = new Date(Date.now() - 5_000).toISOString(); // 5 másodperce
    store.seedSending(200, 100, recentAttemptedAt);

    const targets = [{ orderId: 200, pickupDayId: 100 }];
    const orderData = new Map([[200, { orderNumber: 'HO-0200', recipient: 'fresh@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['fresh@example.hu', 'would-send']]), store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(fx.smtp2goCalls.length, 0, 'a fresh "sending" row must never trigger a send attempt');
    assert.equal(result.stats.skippedCount, 1);
    assert.equal(result.stats.uncertainCount, 0);
    assert.equal(result.uncertain.length, 0);
    assert.equal(store.getRow(200, 100).status, 'sending', 'a fresh sending row is left untouched, not reclaimed');
});

test('worker crash szimuláció: egy régen "sending" állapotban ragadt rekordot a rendszer stale-ként ismer fel', async () => {
    const store = createMockReminderStore();
    const { STALE_SENDING_THRESHOLD_MS } = reminderStalenessModule;
    const staleAttemptedAt = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS - 60_000).toISOString(); // küszöbnél régebbi
    store.seedSending(201, 100, staleAttemptedAt);

    const targets = [{ orderId: 201, pickupDayId: 100 }];
    const orderData = new Map([[201, { orderNumber: 'HO-0201', recipient: 'crashed@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['crashed@example.hu', 'would-send']]), store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(result.stats.uncertainCount, 1);
    assert.equal(result.uncertain.length, 1);
    assert.equal(result.uncertain[0].orderNumber, 'HO-0201');
    assert.equal(result.uncertain[0].recipient, 'crashed@example.hu');
});

test('stale "sending": SOHA nem indul belőle automatikus (vak) újraküldés - a rekord "sending" marad, nincs SMTP2GO-hívás', async () => {
    const store = createMockReminderStore();
    const { STALE_SENDING_THRESHOLD_MS } = reminderStalenessModule;
    const staleAttemptedAt = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS - 60_000).toISOString();
    store.seedSending(202, 100, staleAttemptedAt);

    const targets = [{ orderId: 202, pickupDayId: 100 }];
    const orderData = new Map([[202, { orderNumber: 'HO-0202', recipient: 'nodupe@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map([['nodupe@example.hu', 'would-send']]), store });
    await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(fx.smtp2goCalls.length, 0, 'a stale "sending" row must NEVER be blindly retried - that could double-email the customer');
    assert.equal(store.claimCalls.length, 1, 'only the original (simulated) claim exists - this run never re-claims the stale row');
    const row = store.getRow(202, 100);
    assert.equal(row.status, 'sending', 'the row is left exactly as-is for manual review, not auto-flipped to sent or failed');
});

// Példa 1 az üzleti szabályból: attempted=0, uncertain=1 -> NINCS admin
// e-mail. Az uncertainCount önmagában SOHA nem triggerelhet admin
// összesítőt - csak attemptedCount >= 1 esetén.
test('uncertainCount önmagában NEM triggerel admin összesítőt, ha ebben a futásban nulla tényleges kísérlet történt', async () => {
    const store = createMockReminderStore();
    const { STALE_SENDING_THRESHOLD_MS } = reminderStalenessModule;
    const staleAttemptedAt = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS - 60_000).toISOString();
    store.seedSending(203, 100, staleAttemptedAt);

    const targets = [{ orderId: 203, pickupDayId: 100 }];
    const orderData = new Map([[203, { orderNumber: 'HO-0203', recipient: 'uncertain@example.hu', county: 'Csongrád-Csanád' }]]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient: new Map(), store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(result.stats.attemptedCount, 0, 'no real attempt happened in this run');
    assert.equal(result.stats.uncertainCount, 1);
    assert.equal(fx.adminSummaryCalls.length, 0, 'no admin summary may be sent when attemptedCount is 0, even with an uncertain reminder present');
});

// Példa 3 az üzleti szabályból: attempted=2 (sent=1, failed=1), uncertain=1
// -> VAN admin e-mail, és az uncertain a jelenlegi részletességgel szerepel
// benne.
test('ha attemptedCount >= 1, az admin összesítő elkészül ÉS a stale/uncertain rekordok is szerepelnek benne', async () => {
    const store = createMockReminderStore();
    const { STALE_SENDING_THRESHOLD_MS } = reminderStalenessModule;
    const staleAttemptedAt = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS - 60_000).toISOString();
    store.seedSending(204, 100, staleAttemptedAt);

    const targets = [
        { orderId: 204, pickupDayId: 100 }, // stale "sending" -> uncertain
        { orderId: 205, pickupDayId: 100 }, // sikeres kísérlet
        { orderId: 206, pickupDayId: 100 }, // sikertelen kísérlet
    ];
    const orderData = new Map([
        [204, { orderNumber: 'HO-0204', recipient: 'uncertain2@example.hu', county: 'Csongrád-Csanád' }],
        [205, { orderNumber: 'HO-0205', recipient: 'ok@example.hu', county: 'Csongrád-Csanád' }],
        [206, { orderNumber: 'HO-0206', recipient: 'bad@example.hu', county: 'Csongrád-Csanád' }],
    ]);
    const sendOutcomeByRecipient = new Map([
        ['ok@example.hu', 'msg-205'],
        ['bad@example.hu', new Error('rejected')],
    ]);

    const fx = buildFixtureBySendOutcome({ targets, orderData, sendOutcomeByRecipient, store });
    const result = await fx.sendPickupReminders(fakeSupabase, '2026-10-07');

    assert.equal(result.stats.attemptedCount, 2);
    assert.equal(result.stats.sentCount, 1);
    assert.equal(result.stats.failedCount, 1);
    assert.equal(result.stats.uncertainCount, 1);
    assert.equal(fx.adminSummaryCalls.length, 1, 'attemptedCount >= 1 -> exactly one admin summary');
    assert.equal(fx.adminSummaryCalls[0].uncertain.length, 1);
    assert.equal(fx.adminSummaryCalls[0].uncertain[0].orderNumber, 'HO-0204');
    assert.equal(fx.adminSummaryCalls[0].uncertain[0].recipient, 'uncertain2@example.hu');
    assert.match(fx.adminSummaryCalls[0].uncertain[0].detail, /sending/);
});

test('a bizonytalan (uncertain) jelzés szövege megjelenik a renderelt admin összesítőben is', async () => {
    const { buildAdminReminderSummary } = load('../lib/email/adminReminderSummary.ts', {
        '@/lib/email/orderNotification': load('../lib/email/orderNotification.ts', {
            '@/lib/orderWindow': load('../lib/orderWindow.ts'),
            '@/lib/pickupInfo': load('../lib/pickupInfo.ts', { '@/lib/countyGroups': load('../lib/countyGroups.ts') }),
            '@/lib/countyGroups': load('../lib/countyGroups.ts'),
        }),
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => true },
        '@/lib/email/smtp2go': { sendSmtp2GoEmail: async () => ({ id: 'unused' }) },
    });

    const stats = { eligibleCount: 1, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 0, uncertainCount: 1 };
    const uncertain = [{ orderId: 203, orderNumber: 'HO-0203', recipient: 'uncertain@example.hu', detail: '14 perce "sending" állapotban van - manuális ellenőrzés szükséges.' }];
    const summary = buildAdminReminderSummary({ runAt: new Date(), pickupDateIso: '2026-10-07', stats, failures: [], uncertain });

    assert.ok(summary.text.includes('HO-0203'));
    assert.ok(summary.text.includes('uncertain@example.hu'));
    assert.ok(summary.text.includes('manuális ellenőrzés'));
    assert.ok(summary.html.includes('HO-0203'));
    assert.ok(summary.html.includes('Bizonytalan'));
});
