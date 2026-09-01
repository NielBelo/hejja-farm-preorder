const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/adminOrderFilters.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const filterModule = { exports: {} };
new Function('exports', compiled)(filterModule.exports);
const { emptyFilters, matchesOrderFilters, getOrderFilterOptions } = filterModule.exports;
const today = '2026-08-31';
const order = (id, county, pickup, products, status = 'submitted') => ({
    id, user_id: `user-${id}`, status,
    profile: { last_name: 'Kiss', first_name: `Vásárló ${id}`, county },
    pickup_days: { pickup_date: pickup },
    order_versions: { order_items: products.map((product_id) => ({ product_id, products: { name: `Termék ${product_id}` } })) },
});
const orders = [
    order(1, 'Pest', today, [1, 2]),
    order(2, 'Somogy', '2026-09-01', [2]),
    order(3, 'Pest', '2026-08-30', [1]),
    order(4, null, '2026-08-30', [3], 'cancelled'),
];
const match = (filters) => orders.filter((entry) => matchesOrderFilters(entry, { ...emptyFilters, ...filters }, today)).map((entry) => entry.id);

test('no selection returns all orders', () => assert.deepEqual(match({}), [1, 2, 3, 4]));
test('multiple choices within a filter use OR', () => assert.deepEqual(match({ county: ['Pest', 'Somogy'] }), [1, 2, 3]));
test('different filters use AND and product matches any current item', () => {
    assert.deepEqual(match({ county: ['Pest'], product: ['2'], status: ['current'] }), [1]);
    assert.deepEqual(match({ county: ['Somogy'], product: ['1'] }), []);
});
test('name and pickup filters combine', () => assert.deepEqual(match({ name: ['user-1', 'user-2'], pickup: ['2026-09-01'] }), [2]));
test('pickup today is current; cancellation overrides past date', () => {
    assert.deepEqual(match({ status: ['current'] }), [1, 2]);
    assert.deepEqual(match({ status: ['past'] }), [3]);
    assert.deepEqual(match({ status: ['cancelled'] }), [4]);
});
test('missing county can be selected', () => assert.deepEqual(match({ county: ['Nincs megadva'] }), [4]));
test('options are deduplicated and dates are chronological', () => {
    const options = getOrderFilterOptions(orders, today);
    assert.equal(options.product.length, 3);
    assert.equal(options.county.length, 3);
    assert.deepEqual(options.pickup.map((entry) => entry.value), ['2026-08-30', today, '2026-09-01']);
});
test('different customers with the same name remain distinct', () => {
    const duplicate = { ...orders[1], profile: { ...orders[0].profile } };
    assert.equal(getOrderFilterOptions([orders[0], duplicate], today).name.length, 2);
});
test('timestamp pickup dates display the Hungarian weekday and share the same calendar-day option', () => {
    const entries = [order(5, 'Pest', '2026-09-27T00:00:00', [1]), order(6, 'Pest', '2026-09-27', [2])];
    assert.deepEqual(getOrderFilterOptions(entries, today).pickup, [
        { value: '2026-09-27', label: '2026. 09. 27. – vasárnap' },
    ]);
    for (const entry of entries) {
        assert.equal(matchesOrderFilters(entry, { ...emptyFilters, pickup: ['2026-09-27'] }, today), true);
    }
});
test('past timestamp and same-day timestamp have correct status', () => {
    assert.equal(matchesOrderFilters(order(7, 'Pest', '2026-08-30T00:00:00', [1]), { ...emptyFilters, status: ['past'] }, today), true);
    assert.equal(matchesOrderFilters(order(8, 'Pest', `${today}T00:00:00`, [1]), { ...emptyFilters, status: ['current'] }, today), true);
});
test('missing profile and order version do not crash filtering', () => {
    const missing = { ...orders[0], profile: null, order_versions: null };
    assert.equal(matchesOrderFilters(missing, emptyFilters, today), true);
    assert.equal(matchesOrderFilters(missing, { ...emptyFilters, product: ['1'] }, today), false);
    assert.equal(getOrderFilterOptions([missing], today).name[0].label, 'Ismeretlen felhasználó');
});
