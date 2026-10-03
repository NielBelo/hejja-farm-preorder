const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/orderingAvailability.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const availabilityModule = { exports: {} };
new Function('exports', compiled)(availabilityModule.exports);
const { getDisplayPickupDay } = availabilityModule.exports;

const normalDay = { id: 11, is_active: true };
const dunavecseDay = { id: 99, is_active: true };
const inactiveDunavecseDay = { id: 99, is_active: false };

test('normal county, window open: the selected pickup day stays active', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: true,
            isBacsKiskun: false,
            selectedPickupDay: normalDay,
            dunavecsePickupDay: dunavecseDay,
        }),
        normalDay,
    );
});

test('normal county, window closed: no pickup day, even if one was selected before closing', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: false,
            isBacsKiskun: false,
            selectedPickupDay: normalDay,
            dunavecsePickupDay: dunavecseDay,
        }),
        null,
    );
});

test('Bacs-Kiskun (DUNAVECSE), window open: the active DUNAVECSE day is used', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: true,
            isBacsKiskun: true,
            selectedPickupDay: null,
            dunavecsePickupDay: dunavecseDay,
        }),
        dunavecseDay,
    );
});

test('Bacs-Kiskun (DUNAVECSE), window closed: no pickup day, even though the DUNAVECSE day is active', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: false,
            isBacsKiskun: true,
            selectedPickupDay: null,
            dunavecsePickupDay: dunavecseDay,
        }),
        null,
    );
});

test('Bacs-Kiskun (DUNAVECSE), window open but DUNAVECSE day inactive: no pickup day', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: true,
            isBacsKiskun: true,
            selectedPickupDay: null,
            dunavecsePickupDay: inactiveDunavecseDay,
        }),
        null,
    );
});

test('Bacs-Kiskun ignores a stale normal pickup day selection', () => {
    assert.equal(
        getDisplayPickupDay({
            isOrderingOpen: true,
            isBacsKiskun: true,
            selectedPickupDay: normalDay,
            dunavecsePickupDay: dunavecseDay,
        }),
        dunavecseDay,
    );
});
