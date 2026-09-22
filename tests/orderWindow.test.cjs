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
const { formatOrderWindowEnd, getOrderWindowEnd, getOrderWindowStart, getCalendarDate } = orderWindowModule.exports;

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

test('interprets a summer opening date as 00:00 in Budapest', () => {
    // A DB-oldali normalize_season_time_window_start trigger a
    // budapesti éjfélt UTC-ben tárolja (pl. nyáron 2026-09-05T00:00:00
    // helyi idő = 2026-09-04T22:00:00Z) - a kliensnek ugyanezt a pillanatot
    // kell visszakapnia a nyers time_window_start-ból, függetlenül attól,
    // hogy az napközbeni időponttal (pl. UTC éjfél) érkezik-e.
    assert.equal(
        getOrderWindowStart('2026-09-05T00:00:00Z').toISOString(),
        '2026-09-04T22:00:00.000Z',
    );
});

test('uses the winter Budapest offset for opening dates after DST', () => {
    assert.equal(
        getOrderWindowStart('2026-11-05').toISOString(),
        '2026-11-04T23:00:00.000Z',
    );
});

test('returns null for an invalid opening date', () => {
    assert.equal(getOrderWindowStart('not-a-date'), null);
});

test('getCalendarDate reads the Budapest calendar day, not the raw UTC date', () => {
    // Ha egy budapesti éjfélt jelölő pillanatot UTC-ben szerializálnak (pl.
    // nyáron 2026-09-05T00:00 helyi idő = 2026-09-04T22:00:00Z), a naiv
    // `.slice(0, 10)` "2026-09-04"-et adna - eggyel korábbi, hibás dátumot.
    assert.equal(getCalendarDate('2026-09-04T22:00:00Z'), '2026-09-05');
    assert.equal(getCalendarDate('not-a-date'), null);
});
