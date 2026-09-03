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
const {
    buildAdminSeasonOptions,
    emptyFilters,
    getDefaultAdminSeason,
    getDefaultOrderFilters,
    getPickupSeason,
    matchesOrderFilters,
    getOrderFilterOptions,
} = filterModule.exports;
const today = '2026-08-31';
const order = (id, county, pickup, products, status = 'submitted', year = 2026, season = pickup.includes('-09-') ? 'Ősz' : 'Nyár') => ({
    id, user_id: `user-${id}`, status,
    profile: { last_name: 'Kiss', first_name: `Vásárló ${id}`, county },
    pickup_days: { pickup_date: pickup, year, season },
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
test('defaults to the latest available season and current orders', () => {
    const defaults = getDefaultOrderFilters('2026-3-ősz');
    assert.deepEqual(defaults, {
        season: ['2026-3-ősz'],
        pickup: [],
        county: [],
        name: [],
        status: ['current'],
    });
    assert.deepEqual(match(defaults), [2]);
});
test('groups pickup days into seasons and prefers the latest active season', () => {
    const seasons = buildAdminSeasonOptions([
        { id: 1, year: 2025, season: 'Ősz', pickup_date: '2025-10-10', is_active: false },
        { id: 2, year: 2026, season: 'Tavasz', pickup_date: '2026-04-10', is_active: true },
        { id: 3, year: 2026, season: 'Tavasz', pickup_date: '2026-05-10', is_active: false },
        { id: 4, year: 2026, season: 'Ősz', pickup_date: '2026-10-10', is_active: false },
    ]);

    assert.deepEqual(seasons, [
        { value: '2025-3-ősz', label: '2025 Ősz', pickupDayIds: [1], latestPickupDate: '2025-10-10', isActive: false },
        { value: '2026-1-tavasz', label: '2026 Tavasz', pickupDayIds: [2, 3], latestPickupDate: '2026-05-10', isActive: true },
        { value: '2026-3-ősz', label: '2026 Ősz', pickupDayIds: [4], latestPickupDate: '2026-10-10', isActive: false },
    ]);
    assert.equal(getDefaultAdminSeason(seasons).value, '2026-1-tavasz');
    assert.equal(getDefaultAdminSeason(seasons.map((season) => ({ ...season, isActive: false }))).value, '2026-3-ősz');
});
test('multiple choices within a filter use OR', () => assert.deepEqual(match({ county: ['Pest', 'Somogy'] }), [1, 2, 3]));
test('different filters use AND', () => {
    assert.deepEqual(match({ county: ['Pest'], season: ['2026-2-nyár'], status: ['current'] }), [1]);
    assert.deepEqual(match({ county: ['Somogy'], season: ['2026-1-tavasz'] }), []);
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
    assert.deepEqual(options.season, [
        { value: '2026-2-nyár', label: '2026 Nyár' },
        { value: '2026-3-ősz', label: '2026 Ősz' },
    ]);
    assert.equal(options.county.length, 3);
    assert.deepEqual(options.pickup.map((entry) => entry.value), ['2026-08-30', today, '2026-09-01']);
});
test('standard status choices remain available for an empty loaded season', () => {
    assert.deepEqual(getOrderFilterOptions([], today).status.map((entry) => entry.value), [
        'current',
        'cancelled',
        'past',
    ]);
});
test('formats the season stored on the pickup day', () => {
    assert.deepEqual(getPickupSeason(2026, 'tél'), { value: '2026-0-tél', label: '2026 Tél' });
    assert.deepEqual(getPickupSeason(2026, 'Tavasz'), { value: '2026-1-tavasz', label: '2026 Tavasz' });
    assert.deepEqual(getPickupSeason(2026, 'NYÁR'), { value: '2026-2-nyár', label: '2026 Nyár' });
    assert.deepEqual(getPickupSeason(2026, 'Ősz'), { value: '2026-3-ősz', label: '2026 Ősz' });
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
    assert.equal(getOrderFilterOptions([missing], today).name[0].label, 'Ismeretlen felhasználó');
});
