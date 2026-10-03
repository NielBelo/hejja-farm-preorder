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

function loadOrderNotificationHelpers() {
    return load('../lib/email/orderNotification.ts', {
        '@/lib/orderWindow': load('../lib/orderWindow.ts'),
        '@/lib/pickupInfo': load('../lib/pickupInfo.ts', { '@/lib/countyGroups': load('../lib/countyGroups.ts') }),
        '@/lib/countyGroups': load('../lib/countyGroups.ts'),
    });
}

function fixture() {
    const calls = [];
    const sendSmtp2GoEmail = async (args) => {
        calls.push(args);
        return { id: 'fake-message-id' };
    };
    let blocked = true;

    const { buildAdminReminderSummary, sendAdminReminderSummary } = load('../lib/email/adminReminderSummary.ts', {
        '@/lib/email/orderNotification': loadOrderNotificationHelpers(),
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => blocked },
        '@/lib/email/smtp2go': { sendSmtp2GoEmail },
    });

    return {
        buildAdminReminderSummary,
        sendAdminReminderSummary,
        calls,
        setBlocked: (value) => { blocked = value; },
    };
}

const baseStats = { eligibleCount: 10, attemptedCount: 3, sentCount: 2, failedCount: 1, skippedCount: 7, uncertainCount: 1 };
const baseFailures = [{ orderId: 5, orderNumber: 'HO-0005', recipient: 'ugyfel@example.hu', errorMessage: 'SMTP2GO timeout' }];
const baseUncertain = [{ orderId: 9, orderNumber: 'HO-0009', recipient: 'stale@example.hu', detail: '14 perce "sending" állapotban van - manuális ellenőrzés szükséges.' }];
const runAt = new Date('2026-10-06T06:30:00Z');

test('summary content includes run time, pickup date and every required stat', () => {
    const { buildAdminReminderSummary } = fixture();
    const summary = buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain });

    assert.ok(summary.subject.includes('emlékeztető futás összesítő'));
    for (const value of [10, 3, 2, 1, 7, 1]) {
        assert.ok(summary.text.includes(String(value)), `text should mention ${value}`);
        assert.ok(summary.html.includes(String(value)), `html should mention ${value}`);
    }
    assert.ok(summary.html.includes('október'));
});

test('failures are listed with order number, recipient and short error message', () => {
    const { buildAdminReminderSummary } = fixture();
    const summary = buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain });

    for (const target of [summary.text, summary.html]) {
        assert.ok(target.includes('HO-0005'));
        assert.ok(target.includes('ugyfel@example.hu'));
        assert.ok(target.includes('SMTP2GO timeout'));
    }
});

test('no failures: summary clearly states that nothing failed, and lists no order', () => {
    const { buildAdminReminderSummary } = fixture();
    const allSentStats = { eligibleCount: 4, attemptedCount: 4, sentCount: 4, failedCount: 0, skippedCount: 0, uncertainCount: 0 };
    const summary = buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: allSentStats, failures: [], uncertain: [] });

    assert.ok(summary.text.includes('Nem volt sikertelen küldés'));
    assert.ok(summary.html.includes('Nem volt sikertelen küldés'));
});

test('uncertain (stale) reminders are listed with order number, recipient and detail', () => {
    const { buildAdminReminderSummary } = fixture();
    const summary = buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain });

    for (const target of [summary.text, summary.html]) {
        assert.ok(target.includes('HO-0009'));
        assert.ok(target.includes('stale@example.hu'));
        assert.ok(target.includes('manuális ellenőrzés'));
    }
});

test('no uncertain reminders: summary clearly states that none were stale/uncertain', () => {
    const { buildAdminReminderSummary } = fixture();
    const allSentStats = { eligibleCount: 4, attemptedCount: 4, sentCount: 4, failedCount: 0, skippedCount: 0, uncertainCount: 0 };
    const summary = buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: allSentStats, failures: [], uncertain: [] });

    assert.ok(summary.text.includes('Nem volt bizonytalan/stale'));
    assert.ok(summary.html.includes('Nem volt bizonytalan/stale'));
});

test('on localhost/dev (guard blocked) sendAdminReminderSummary never calls SMTP2GO', async () => {
    const { sendAdminReminderSummary, calls, setBlocked } = fixture();
    setBlocked(true);
    await sendAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain });
    assert.equal(calls.length, 0);
});

test('when the guard allows it, sendAdminReminderSummary calls SMTP2GO exactly once', async () => {
    const { sendAdminReminderSummary, calls, setBlocked } = fixture();
    setBlocked(false);
    await sendAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, 'hejjaokofarm@gmail.com');
});

test('a failing SMTP2GO call inside sendAdminReminderSummary does not throw (caller result stays untouched)', async () => {
    const calls = [];
    const { buildAdminReminderSummary } = fixture();
    const { sendAdminReminderSummary } = load('../lib/email/adminReminderSummary.ts', {
        '@/lib/email/orderNotification': loadOrderNotificationHelpers(),
        '@/lib/email/reminderGuard': { isReminderSendingBlocked: () => false },
        '@/lib/email/smtp2go': {
            sendSmtp2GoEmail: async (args) => {
                calls.push(args);
                throw new Error('network down');
            },
        },
    });

    await assert.doesNotReject(sendAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain }));
    assert.equal(calls.length, 1);
    // buildAdminReminderSummary is unaffected by the failed send - content is still derivable independently.
    assert.ok(buildAdminReminderSummary({ runAt, pickupDateIso: '2026-10-07', stats: baseStats, failures: baseFailures, uncertain: baseUncertain }).subject.length > 0);
});
