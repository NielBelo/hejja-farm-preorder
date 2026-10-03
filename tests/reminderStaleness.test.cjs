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

const { STALE_SENDING_THRESHOLD_MS, isStaleSending, formatSendingDuration } = load('../lib/email/reminderStaleness.ts');

const now = new Date('2026-10-07T08:00:00Z');

test('a "sending" row claimed moments ago is not stale', () => {
    const attemptedAt = new Date(now.getTime() - 30_000).toISOString(); // 30s ago
    assert.equal(isStaleSending(attemptedAt, now), false);
});

test('a "sending" row right at the threshold is considered stale (inclusive)', () => {
    const attemptedAt = new Date(now.getTime() - STALE_SENDING_THRESHOLD_MS).toISOString();
    assert.equal(isStaleSending(attemptedAt, now), true);
});

test('a "sending" row well past the threshold is stale', () => {
    const attemptedAt = new Date(now.getTime() - STALE_SENDING_THRESHOLD_MS * 3).toISOString();
    assert.equal(isStaleSending(attemptedAt, now), true);
});

test('a "sending" row just under the threshold is not yet stale', () => {
    const attemptedAt = new Date(now.getTime() - (STALE_SENDING_THRESHOLD_MS - 1000)).toISOString();
    assert.equal(isStaleSending(attemptedAt, now), false);
});

test('missing or unparsable attemptedAt is never treated as stale (fails safe toward "fresh")', () => {
    assert.equal(isStaleSending(null, now), false);
    assert.equal(isStaleSending('not-a-date', now), false);
});

test('formatSendingDuration renders whole minutes in Hungarian', () => {
    assert.equal(formatSendingDuration(new Date(now.getTime() - 60_000).toISOString(), now), '1 perce');
    assert.equal(formatSendingDuration(new Date(now.getTime() - 14 * 60_000).toISOString(), now), '14 perce');
});

test('formatSendingDuration falls back gracefully for missing/unparsable input', () => {
    assert.equal(formatSendingDuration(null, now), 'ismeretlen ideje');
    assert.equal(formatSendingDuration('garbage', now), 'ismeretlen ideje');
});
