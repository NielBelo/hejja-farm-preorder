const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/orderWindow.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const orderWindowModule = { exports: {} };
new Function('exports', compiled)(orderWindowModule.exports);
const { formatOrderWindowEnd, getOrderWindowEnd } = orderWindowModule.exports;

test('interprets a summer closing date as 23:59 in Budapest', () => {
    assert.equal(
        getOrderWindowEnd('2026-09-05T00:00:00Z').toISOString(),
        '2026-09-05T21:59:59.999Z',
    );
    assert.match(formatOrderWindowEnd('2026-09-05'), /23:59/);
});

test('uses the winter Budapest offset for closing dates after DST', () => {
    assert.equal(
        getOrderWindowEnd('2026-11-05').toISOString(),
        '2026-11-05T22:59:59.999Z',
    );
});

test('returns null for an invalid closing date', () => {
    assert.equal(getOrderWindowEnd('not-a-date'), null);
});
