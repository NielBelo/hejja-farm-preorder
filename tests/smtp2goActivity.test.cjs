const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/email/smtp2goActivity.ts'), 'utf8').replace(/^import "server-only";\r?\n/m, '');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', compiled)(mod.exports, mod);
const { toEmailLogRow, isEmailLogStatusFilter } = mod.exports;

const base = { email_id: 'abc', date: '2026-10-14T22:36:37Z', recipient: 'a@example.com', subject: 'Tárgy' };

test('delivered és a későbbi opened/clicked is Kézbesítve', () => {
    for (const event of ['delivered', 'opened', 'clicked']) {
        const row = toEmailLogRow({ ...base, event });
        assert.equal(row.statusLabel, 'Kézbesítve');
        assert.equal(row.tone, 'success');
    }
});

test('a processed (elfogadott, még nem kézbesített) nem számít kézbesítettnek', () => {
    const row = toEmailLogRow({ ...base, event: 'processed' });
    assert.equal(row.statusLabel, 'Feldolgozás alatt');
    assert.equal(row.tone, 'neutral');
});

test('visszapattanás és elutasítás hibaként jelenik meg okkal', () => {
    const bounced = toEmailLogRow({ ...base, event: 'hard-bounced', reason: 'No such user' });
    assert.equal(bounced.tone, 'error');
    assert.equal(bounced.detail, 'No such user');
    assert.equal(toEmailLogRow({ ...base, event: 'rejected' }).statusLabel, 'Elutasítva');
    assert.equal(toEmailLogRow({ ...base, event: 'soft-bounced' }).tone, 'warning');
});

test('ismeretlen esemény nem lesz kézbesítve, dátum nélküli esemény kimarad', () => {
    assert.equal(toEmailLogRow({ ...base, event: 'whatever' }).statusLabel, 'Ismeretlen állapot');
    assert.equal(toEmailLogRow({ ...base, date: undefined, event: 'delivered' }), null);
});

test('státuszszűrő csak ismert értéket fogad el', () => {
    assert.equal(isEmailLogStatusFilter('bounced'), true);
    assert.equal(isEmailLogStatusFilter('toString'), false);
});
