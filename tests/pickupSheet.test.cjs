const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/pickupSheet.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sheetModule = { exports: {} };
new Function('exports', compiled)(sheetModule.exports);
const {
    formatPhoneNumber,
    formatPickupDate,
    getInitialPickupDate,
    getPickupDistributions,
    getPickupDateOptions,
    normalizePickupDate,
    sortPickupOrders,
    summarizePackage,
    summarizePickupOrders,
    summarizePickupStock,
    summarizeProduct,
    summarizeSize,
} = sheetModule.exports;

const order = (id, name, pickupDate, publicOrderNumber) => ({
    id, customerName: name, pickupDate, public_order_number: publicOrderNumber,
    user_id: `user-${id}`, phone: '+36301234567', items: [],
});

const pickupDay = (pickupDate, plannedStock = 150, availableStock = 120) => ({
    pickup_date: pickupDate,
    planned_stock: plannedStock,
    available_stock: availableStock,
});

test('normalizes database timestamps without changing the calendar day', () => {
    assert.equal(normalizePickupDate('2026-09-27T00:00:00'), '2026-09-27');
    assert.equal(normalizePickupDate('2026-09-27'), '2026-09-27');
    assert.equal(normalizePickupDate('invalid'), '');
});

test('formats pickup date with its Hungarian weekday', () => {
    assert.equal(formatPickupDate('2026-09-27T00:00:00'), '2026. szeptember 27., vasárnap');
});

test('deduplicates and sorts pickup dates', () => {
    const pickupDays = [
        pickupDay('2026-10-04', 200, 180),
        pickupDay('2026-09-27T00:00:00', 150, 120),
        pickupDay('2026-09-27T00:00:00', 150, 120),
    ];
    assert.deepEqual(getPickupDateOptions(pickupDays), [
        {
            value: '2026-09-27',
            label: '2026. szeptember 27., vasárnap',
            plannedStock: 150,
            availableStock: 120,
        },
        {
            value: '2026-10-04',
            label: '2026. október 4., vasárnap',
            plannedStock: 200,
            availableStock: 180,
        },
    ]);
});

test('selects the nearest upcoming date, or the latest past date', () => {
    const dates = ['2026-08-30', '2026-09-06', '2026-09-13'];
    assert.equal(getInitialPickupDate(dates, '2026-09-02'), '2026-09-06');
    assert.equal(getInitialPickupDate(dates, '2026-09-20'), '2026-09-13');
    assert.equal(getInitialPickupDate([], '2026-09-02'), '');
});

test('sorts by customer name and then by natural order identifier', () => {
    const orders = [
        order(1, 'Nagy Béla', '2026-09-27', 'R-1'),
        order(2, 'Kiss Anna', '2026-09-27', 'R-10'),
        order(3, 'Kiss Anna', '2026-09-27', 'R-2'),
    ];
    assert.deepEqual(sortPickupOrders(orders).map((entry) => entry.id), [3, 2, 1]);
});

test('formats stored Hungarian phone numbers', () => {
    assert.equal(formatPhoneNumber('+36301234567'), '+36 30 123 4567');
    assert.equal(formatPhoneNumber('—'), '—');
});

test('shortens package and size descriptions for the compact table', () => {
    assert.equal(summarizeProduct('Darabolt csirke'), 'Darab');
    assert.equal(summarizeProduct('Egész csirke'), 'Egész');
    assert.equal(summarizePackage('Gyűjtőcsomagolás'), 'Gyűjtő');
    assert.equal(summarizePackage('Egyedi csomagolás'), 'Egyedi');
    assert.equal(summarizeSize('Átlagostól inkább kisebbet kérek, ha lehet'), 'Kisebb');
    assert.equal(summarizeSize('Átlagostól inkább nagyobbat kérek, ha lehet'), 'Nagyobb');
    assert.equal(summarizeSize('Átlagos méret megfelelő'), 'Átlagos');
    assert.equal(summarizeSize(null), 'Átlagos');
});

test('summarizes distinct customers, orders, items, and ordered chickens', () => {
    const orders = [
        {
            ...order(1, 'Kiss Anna', '2026-09-27', 'R-1'),
            items: [{ quantity: 3 }, { quantity: 2 }],
        },
        {
            ...order(2, 'Kiss Anna', '2026-09-27', 'R-2'),
            user_id: 'user-1',
            items: [{ quantity: 4 }],
        },
        {
            ...order(3, 'Nagy Béla', '2026-09-27', 'R-3'),
            items: [{ quantity: 1 }],
        },
    ];

    assert.deepEqual(summarizePickupOrders(orders), {
        customerCount: 2,
        orderCount: 3,
        itemCount: 4,
        chickenCount: 10,
    });
});

test('summarizes used and available pickup stock as a 100 percent split', () => {
    assert.deepEqual(summarizePickupStock(150, 40), {
        capacity: 150,
        usedCount: 110,
        availableCount: 40,
        usedPercentage: 110 / 150 * 100,
        availablePercentage: 40 / 150 * 100,
    });

    assert.deepEqual(summarizePickupStock(100, 130), {
        capacity: 100,
        usedCount: 0,
        availableCount: 100,
        usedPercentage: 0,
        availablePercentage: 100,
    });
});

test('builds quantity and percentage distributions for the charts', () => {
    const orders = [{
        ...order(1, 'Kiss Anna', '2026-09-27', 'R-1'),
        items: [
            {
                quantity: 6,
                products: { name: 'Egész csirke' },
                packages: { name: 'Gyűjtőcsomagolás' },
                size_preference: 'Átlagos méret megfelelő',
            },
            {
                quantity: 4,
                products: { name: 'Darabolt csirke' },
                packages: { name: 'Egyedi csomagolás' },
                size_preference: 'Átlagostól inkább nagyobbat kérek, ha lehet',
            },
        ],
    }];

    const distributions = getPickupDistributions(orders);
    assert.deepEqual(distributions.products, [
        { label: 'Egész', quantity: 6, percentage: 60 },
        { label: 'Darab', quantity: 4, percentage: 40 },
    ]);
    assert.deepEqual(distributions.packages, [
        { label: 'Gyűjtő', quantity: 6, percentage: 60 },
        { label: 'Egyedi', quantity: 4, percentage: 40 },
    ]);
    assert.deepEqual(distributions.sizes, [
        { label: 'Átlagos', quantity: 6, percentage: 60 },
        { label: 'Nagyobb', quantity: 4, percentage: 40 },
    ]);
});
