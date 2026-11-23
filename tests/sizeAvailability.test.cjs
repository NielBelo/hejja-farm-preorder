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
const { getSizeRemaining, fitItemsToSizeAvailability } = load('../lib/sizeAvailability.ts', { '@/lib/sizePreferences': sizePreferences });

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

test('fitting leaves items untouched when they fit or the day has no limit', () => {
    const items = [item(SMALL, 2), item(LARGE, 3), placeholder];
    for (const availability of [null, { small: null, large: null }, { small: 2, large: 3 }, { small: 9, large: 9 }]) {
        const result = fitItemsToSizeAvailability(items, availability);
        assert.equal(result.changed, false);
        assert.deepEqual(result.items, items);
    }
});

test('fitting reduces the quantity of an item that only partly fits', () => {
    const result = fitItemsToSizeAvailability([item(SMALL, 6), placeholder], { small: 2, large: null });
    assert.equal(result.changed, true);
    assert.equal(result.reducedCount, 1);
    assert.equal(result.removedCount, 0);
    assert.deepEqual(result.items.map((i) => i.quantity), [2, 1]);
});

test('fitting leaves out items of a size with no room left, instead of changing their size', () => {
    const items = [item(SMALL, 3), item(SMALL, 2), item(AVERAGE, 4), placeholder];
    const result = fitItemsToSizeAvailability(items, { small: 3, large: null });
    assert.equal(result.changed, true);
    assert.equal(result.reducedCount, 0);
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.items.map((i) => [i.selectedNote, i.quantity]), [[SMALL, 3], [AVERAGE, 4], [AVERAGE, 1]]);
});

test('fitting distributes the limit over the items in order, across sizes independently', () => {
    const items = [item(SMALL, 2), item(LARGE, 5), item(SMALL, 4), item(LARGE, 1)];
    const result = fitItemsToSizeAvailability(items, { small: 3, large: 5 });
    assert.deepEqual(result.items.map((i) => [i.selectedNote, i.quantity]), [[SMALL, 2], [LARGE, 5], [SMALL, 1]]);
    assert.equal(result.reducedCount, 1);
    assert.equal(result.removedCount, 1);
});

test('fitting returns an empty list when no real item is left', () => {
    const result = fitItemsToSizeAvailability([item(SMALL, 2), placeholder], { small: 0, large: null });
    assert.equal(result.changed, true);
    assert.equal(result.removedCount, 1);
    assert.deepEqual(result.items, []);
});
