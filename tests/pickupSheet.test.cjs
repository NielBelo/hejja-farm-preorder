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

const sizePreferencesModule = load('../lib/sizePreferences.ts');
// A lib/adminOrderFilters.ts csak típust importál (import type ... from
// "@/components/admin/AdminOrderCard") - a TypeScript ezt mindig eltávolítja
// fordításkor, így futásidőben nincs szüksége require()-stubra.
const adminOrderFiltersModule = load('../lib/adminOrderFilters.ts');
const { getPickupSeason } = adminOrderFiltersModule;
const sheetModule = {
    exports: load('../lib/pickupSheet.ts', {
        '@/lib/sizePreferences': sizePreferencesModule,
        '@/lib/adminOrderFilters': adminOrderFiltersModule,
    }),
};
const {
    formatPhoneNumber,
    formatPickupDate,
    getInitialPickupDate,
    getPickupDistributions,
    getPickupDateOptions,
    normalizePickupDate,
    sortPickupOrders,
    summarizeCustomerSizePreferenceGroups,
    summarizePackage,
    summarizePickupOrders,
    summarizePickupStock,
    summarizePrintPackage,
    summarizeProduct,
    summarizeSize,
} = sheetModule.exports;

const order = (id, name, pickupDate, publicOrderNumber) => ({
    id, customerName: name, pickupDate, public_order_number: publicOrderNumber,
    user_id: `user-${id}`, phone: '+36301234567', items: [],
});

const pickupDay = (pickupDate, plannedStock = 150, availableStock = 120, kind = 'normal', year = 2026, season = 'Ősz') => ({
    pickup_date: pickupDate,
    planned_stock: plannedStock,
    available_stock: availableStock,
    kind,
    year,
    season,
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
    const season = getPickupSeason(2026, 'Ősz').value;
    assert.deepEqual(getPickupDateOptions(pickupDays), [
        {
            value: `${season}:2026-09-27`,
            date: '2026-09-27',
            kind: 'normal',
            seasonValue: season,
            label: '2026. szeptember 27., vasárnap',
            plannedStock: 150,
            availableStock: 120,
        },
        {
            value: `${season}:2026-10-04`,
            date: '2026-10-04',
            kind: 'normal',
            seasonValue: season,
            label: '2026. október 4., vasárnap',
            plannedStock: 200,
            availableStock: 180,
        },
    ]);
});

test('keeps the DUNAVECSE technical pickup day as a separate, selectable option even when it shares its date with a normal pickup day', () => {
    const pickupDays = [
        pickupDay('2026-09-27', 150, 120, 'normal'),
        pickupDay('2026-09-27', null, null, 'dunavecse'),
    ];
    const season = getPickupSeason(2026, 'Ősz').value;
    assert.deepEqual(getPickupDateOptions(pickupDays), [
        {
            value: `${season}:2026-09-27`,
            date: '2026-09-27',
            kind: 'normal',
            seasonValue: season,
            label: '2026. szeptember 27., vasárnap',
            plannedStock: 150,
            availableStock: 120,
        },
        {
            value: `${season}:dunavecse:2026-09-27`,
            date: '2026-09-27',
            kind: 'dunavecse',
            seasonValue: season,
            label: '2026. szeptember 27., vasárnap – DUNAVECSE (Bács-Kiskun)',
            plannedStock: 0,
            availableStock: 0,
        },
    ]);
});

test('keeps two different seasons\' same-date pickup days as separate options, instead of merging them', () => {
    const pickupDays = [
        pickupDay('2026-09-27', 150, 120, 'normal', 2025, 'Ősz'),
        pickupDay('2026-09-27', 200, 180, 'normal', 2026, 'Ősz'),
    ];
    const options = getPickupDateOptions(pickupDays);
    assert.equal(options.length, 2);
    assert.notEqual(options[0].value, options[1].value);
    assert.notEqual(options[0].seasonValue, options[1].seasonValue);
    assert.deepEqual(options.map((option) => option.plannedStock).sort(), [150, 200]);
});

test('selects the nearest upcoming date, or the latest past date, preferring the normal day over a same-date DUNAVECSE day', () => {
    const dates = [
        { value: '2026-08-30', date: '2026-08-30', kind: 'normal' },
        { value: '2026-09-06', date: '2026-09-06', kind: 'normal' },
        { value: '2026-09-13', date: '2026-09-13', kind: 'normal' },
        { value: 'dunavecse-2026-09-13', date: '2026-09-13', kind: 'dunavecse' },
    ];
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
    // A megjelenített név mindig a jelenlegi adatbázis-elnevezésből
    // (packages.name) származik, nincs csomagolásnév-specifikus hardcode-olt
    // leképezés - a jelenlegi élő adatbázis-elnevezés ("Egyenként") ezért
    // változatlanul, saját néven jelenik meg.
    assert.equal(summarizePackage('Egyenként'), 'Egyenként');
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

test('shows only the collector packaging in the printed pickup sheet, everything else stays blank', () => {
    assert.equal(summarizePrintPackage('Gyűjtőcsomagolás'), 'Gyűjtő');
    assert.equal(summarizePrintPackage('Egyedi csomagolás'), '');
    assert.equal(summarizePrintPackage('Egyenként'), '');
    assert.equal(summarizePrintPackage(null), '');
});

test('groups whole orders by the customer size preference set in the admin profile, ignoring per-item size preference', () => {
    const orders = [
        {
            ...order(1, 'Kiss Anna', '2026-09-27', 'R-1'),
            specialSizePreference: 'larger',
            items: [
                { quantity: 6, products: { name: 'Egész csirke' }, size_preference: 'Átlagostól inkább kisebbet kérek, ha lehet' },
                { quantity: 4, products: { name: 'Darabolt csirke' }, size_preference: 'Átlagos méret megfelelő' },
            ],
        },
        {
            ...order(2, 'Nagy Béla', '2026-09-27', 'R-2'),
            specialSizePreference: 'smaller',
            items: [
                { quantity: 3, products: { name: 'Egész csirke' }, size_preference: 'Átlagostól inkább nagyobbat kérek, ha lehet' },
            ],
        },
        {
            ...order(3, 'Tóth Pál', '2026-09-27', 'R-3'),
            specialSizePreference: null,
            items: [
                { quantity: 9, products: { name: 'Egész csirke' } },
            ],
        },
    ];

    assert.deepEqual(summarizeCustomerSizePreferenceGroups(orders), {
        larger: { total: 10, whole: 6, chopped: 4 },
        smaller: { total: 3, whole: 3, chopped: 0 },
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
