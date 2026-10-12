const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/orderQuantity.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = {};
new Function('exports', compiled)(mod);
const { getRemainingQuantity, getRequiredQuantity } = mod;

const saved = (quantity) => ({ selectedProductId: 1, quantity, touched: true });
const placeholder = { selectedProductId: null, quantity: 1, touched: false };

// A 3. paraméter a maxAvailableQuantity (szabad készlet + a rendelés saját foglalása).
test('the untouched "new item" placeholder does not reduce the editable limit', () => {
    assert.equal(getRemainingQuantity([saved(5), placeholder], 0, 5), 5);
});

test('other real items still reduce the limit', () => {
    assert.equal(getRemainingQuantity([saved(2), saved(3), placeholder], 0, 5), 2);
    assert.equal(getRemainingQuantity([saved(2), saved(3), placeholder], 1, 5), 3);
});

test('a touched placeholder (quantity edited) still counts, so stock cannot be exceeded', () => {
    const touched = { selectedProductId: null, quantity: 2, touched: true };
    assert.equal(getRemainingQuantity([saved(3), touched], 0, 5), 3);
});

test('limit is never below 1 and null means no day limit', () => {
    assert.equal(getRemainingQuantity([saved(5), saved(5)], 0, 5), 1);
    assert.equal(getRemainingQuantity([saved(5)], 0, null), 100);
});

// Átvételi nap váltás: a usePickupDayChange `requiredQuantity > available_stock` esetén utasít el.
const fitsOnDay = (items, availableStock) => !(getRequiredQuantity(items) > availableStock);

test('a 5 db order fits a day with exactly 5 free, with the placeholder present', () => {
    assert.equal(getRequiredQuantity([saved(5), placeholder]), 5);
    assert.equal(fitsOnDay([saved(5), placeholder], 5), true);
});

test('a 5 db order does not fit a day with only 4 free', () => {
    assert.equal(fitsOnDay([saved(5), placeholder], 4), false);
});

test('the placeholder does not add to the required quantity', () => {
    assert.equal(getRequiredQuantity([placeholder]), 0);
});

test('several real items add up, and a touched placeholder counts', () => {
    assert.equal(getRequiredQuantity([saved(2), saved(3), placeholder]), 5);
    assert.equal(getRequiredQuantity([saved(2), { selectedProductId: null, quantity: 4, touched: true }]), 6);
});

test('both edit components use the shared required-quantity helper', () => {
    for (const file of ['../components/OrderActions.tsx', '../components/admin/AdminOrderCard.tsx']) {
        const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.match(src, /const requiredQuantity = getRequiredQuantity\(editedItems\);/);
    }
});
