const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, imports = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (name) => {
        if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
        return imports[name];
    });
    return exports;
}

const sizePreferences = load('../lib/sizePreferences.ts');
const { getSizeRemaining } = load('../lib/sizeAvailability.ts', { '@/lib/sizePreferences': sizePreferences });

const SMALL = 'Átlagostól kisebb méret';
const LARGE = 'Átlagostól nagyobb méret';
const AVERAGE = 'Átlagos méret';
const item = (selectedNote, quantity, extra = {}) => ({ selectedProductId: 1, quantity, touched: true, selectedNote, ...extra });
const placeholder = { selectedProductId: null, quantity: 1, touched: false, selectedNote: AVERAGE };

test('no availability or an unlimited size means no cap', () => {
    assert.equal(getSizeRemaining([item(SMALL, 3)], 0, SMALL, null), null);
    assert.equal(getSizeRemaining([item(SMALL, 3)], 0, SMALL, undefined), null);
    assert.equal(getSizeRemaining([item(SMALL, 3)], 0, SMALL, { small: null, large: 5 }), null);
});

test('the average size is never capped', () => {
    assert.equal(getSizeRemaining([item(AVERAGE, 3)], 0, AVERAGE, { small: 1, large: 1 }), null);
});

test('the remaining amount is the daily limit minus the other items of the same size', () => {
    const items = [item(SMALL, 2), item(SMALL, 3), item(LARGE, 4), item(AVERAGE, 9)];
    assert.equal(getSizeRemaining(items, 0, SMALL, { small: 10, large: 10 }), 7);
    assert.equal(getSizeRemaining(items, 1, SMALL, { small: 10, large: 10 }), 8);
    assert.equal(getSizeRemaining(items, 0, LARGE, { small: 10, large: 10 }), 6);
});

test('the item itself is not counted against its own cap', () => {
    assert.equal(getSizeRemaining([item(SMALL, 5)], 0, SMALL, { small: 5, large: null }), 5);
});

test('an untouched empty placeholder does not use up the limit', () => {
    const smallPlaceholder = { ...placeholder, selectedNote: SMALL };
    assert.equal(getSizeRemaining([item(SMALL, 2), smallPlaceholder], 0, SMALL, { small: 4, large: null }), 4);
    assert.equal(getSizeRemaining([smallPlaceholder, item(SMALL, 2)], 1, SMALL, { small: 4, large: null }), 4);
});

test('the remaining amount never goes below zero', () => {
    assert.equal(getSizeRemaining([item(SMALL, 3), item(SMALL, 9)], 0, SMALL, { small: 4, large: null }), 0);
});
