const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, require);
    return exports;
}

const {
    summarizeReminderOutcomes,
    shouldSendAdminReminderSummary,
    processWithConcurrencyLimit,
} = load('../lib/email/reminderRun.ts');

test('summarizes a mix of sent, failed and skipped outcomes; skip is not an attempt', () => {
    const outcomes = [
        { kind: 'sent' },
        { kind: 'sent' },
        { kind: 'failed', orderId: 1, orderNumber: 'A', recipient: 'a@x.hu', errorMessage: 'boom' },
        { kind: 'skipped' },
        { kind: 'skipped' },
    ];
    const stats = summarizeReminderOutcomes(outcomes, 7);
    assert.deepEqual(stats, {
        eligibleCount: 7,
        attemptedCount: 3, // 2 sent + 1 failed - the 2 skips do NOT count
        sentCount: 2,
        failedCount: 1,
        skippedCount: 2,
        uncertainCount: 0,
    });
});

test('uncertain (stale "sending") outcomes are counted separately, and never count as an attempt', () => {
    const outcomes = [
        { kind: 'sent' },
        { kind: 'uncertain', orderId: 9, orderNumber: 'C', recipient: 'c@x.hu', detail: 'stale' },
        { kind: 'uncertain', orderId: 10, orderNumber: 'D', recipient: 'd@x.hu', detail: 'stale' },
        { kind: 'skipped' },
    ];
    const stats = summarizeReminderOutcomes(outcomes, 4);
    assert.deepEqual(stats, {
        eligibleCount: 4,
        attemptedCount: 1, // only the "sent" - neither uncertain nor skipped counts
        sentCount: 1,
        failedCount: 0,
        skippedCount: 1,
        uncertainCount: 2,
    });
});

test('all-sent run: attemptedCount equals sentCount, no failures', () => {
    const stats = summarizeReminderOutcomes([{ kind: 'sent' }, { kind: 'sent' }, { kind: 'sent' }], 3);
    assert.equal(stats.attemptedCount, 3);
    assert.equal(stats.failedCount, 0);
});

test('all-failed run: attemptedCount still counts every failed attempt', () => {
    const outcomes = [
        { kind: 'failed', orderId: 1, orderNumber: 'A', recipient: 'a@x.hu', errorMessage: 'e1' },
        { kind: 'failed', orderId: 2, orderNumber: 'B', recipient: 'b@x.hu', errorMessage: 'e2' },
    ];
    const stats = summarizeReminderOutcomes(outcomes, 2);
    assert.equal(stats.attemptedCount, 2);
    assert.equal(stats.sentCount, 0);
    assert.equal(stats.failedCount, 2);
});

test('empty run (zero eligible orders): everything is zero', () => {
    const stats = summarizeReminderOutcomes([], 0);
    assert.deepEqual(stats, { eligibleCount: 0, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 0, uncertainCount: 0 });
});

test('admin summary is sent when attemptedCount >= 1, regardless of uncertainCount', () => {
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 5, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 5, uncertainCount: 0 }), false);
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 5, attemptedCount: 1, sentCount: 1, failedCount: 0, skippedCount: 4, uncertainCount: 0 }), true);
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 5, attemptedCount: 5, sentCount: 0, failedCount: 5, skippedCount: 0, uncertainCount: 0 }), true);
    // Example 3 from the business rule: mixed sent/failed + an uncertain one - still exactly one summary.
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 5, attemptedCount: 2, sentCount: 1, failedCount: 1, skippedCount: 1, uncertainCount: 1 }), true);
});

test('admin summary is NEVER sent from uncertainCount alone - attemptedCount = 0 always means no e-mail', () => {
    // Example 1 from the business rule: nothing was actually attempted this run, only a stale/uncertain one was found.
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 3, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 1, uncertainCount: 1 }), false);
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 10, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 0, uncertainCount: 10 }), false);
});

test('admin summary is NOT sent when both attemptedCount and uncertainCount are 0', () => {
    assert.equal(shouldSendAdminReminderSummary({ eligibleCount: 5, attemptedCount: 0, sentCount: 0, failedCount: 0, skippedCount: 5, uncertainCount: 0 }), false);
});

test('processWithConcurrencyLimit never runs more than `limit` workers at the same time', async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await processWithConcurrencyLimit(items, 5, async (item) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item * 2;
    });

    assert.ok(maxInFlight <= 5, `expected at most 5 concurrent workers, saw ${maxInFlight}`);
    assert.deepEqual(results, items.map((item) => item * 2));
});

test('processWithConcurrencyLimit preserves result order even though workers race', async () => {
    const items = [30, 10, 20, 5, 25];
    const results = await processWithConcurrencyLimit(items, 5, async (item) => {
        await new Promise((resolve) => setTimeout(resolve, item));
        return item;
    });
    assert.deepEqual(results, items);
});

test('processWithConcurrencyLimit with fewer items than the limit still runs them all', async () => {
    const results = await processWithConcurrencyLimit([1, 2], 5, async (item) => item + 1);
    assert.deepEqual(results, [2, 3]);
});
