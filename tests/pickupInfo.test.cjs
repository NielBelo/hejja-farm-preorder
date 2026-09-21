const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// lib/pickupInfo.ts mostantól importál a lib/countyGroups.ts-ből ("@/lib/..."
// alias). A ts.transpileModule csak egyetlen fájlt fordít le, bundlelés
// nélkül, ezért a lefordított CommonJS kimenet require("@/lib/countyGroups")
// hívást tartalmaz - ezt a kis require-shimet adjuk neki, ami az alias
// hivatkozást a repógyökérhez képest feloldja és ugyanígy, önmagában
// lefordítja a hivatkozott .ts fájlt.
function loadTsModule(absolutePath) {
    const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    const repoRoot = path.join(__dirname, '..');
    const localRequire = (specifier) => {
        if (specifier.startsWith('@/')) {
            return loadTsModule(path.join(repoRoot, specifier.slice(2)) + '.ts');
        }
        return require(specifier);
    };
    new Function('exports', 'require', compiled)(mod.exports, localRequire);
    return mod.exports;
}

const { getPickupWindowInfo, getBacsKiskunPickupRangeInfo, isBekesCounty, isBacsKiskunCounty } =
    loadTsModule(path.join(__dirname, '../lib/pickupInfo.ts'));

const BEKES_LOCATION = 'Kútvölgy Tanya 1132/A, Hódmezővásárhely – Héjja Ökofarm';
const DEFAULT_LOCATION = 'Hódmezővásárhely, Vámház u. 8/A – Albert Garden Kertészeti Áruda parkolójában';

const baseInput = {
    pickupDate: '2026-10-07',
    pickupTimeStart: '16:30:00',
    pickupTimeEnd: '16:59:00',
    localPickupTimeStart: '15:00:00',
};

test('Bekes county customers get the local pickup location and only the local start time, without the city end time', () => {
    const info = getPickupWindowInfo({ ...baseInput, county: 'Békés' });
    assert.equal(info.location, BEKES_LOCATION);
    assert.equal(info.timeRange, '15:00');
    assert.equal(info.windowLabel, 'október 7. (szerda) 15:00');
});

test('non-Bekes county customers get the default pickup location and the full city time window', () => {
    const info = getPickupWindowInfo({ ...baseInput, county: 'Csongrád-Csanád' });
    assert.equal(info.location, DEFAULT_LOCATION);
    assert.equal(info.timeRange, '16:30 - 16:59');
    assert.equal(info.windowLabel, 'október 7. (szerda) 16:30 - 16:59');
});

test('missing county defaults to the city location and time window', () => {
    const info = getPickupWindowInfo({ ...baseInput, county: null });
    assert.equal(info.location, DEFAULT_LOCATION);
    assert.equal(info.timeRange, '16:30 - 16:59');
});

test('missing local start time yields no time range for Bekes county, even if the city window is set', () => {
    const info = getPickupWindowInfo({ ...baseInput, county: 'Békés', localPickupTimeStart: null });
    assert.equal(info.timeRange, null);
    assert.equal(info.windowLabel, 'október 7. (szerda)');
});

test('isBekesCounty matches only an exact "Békés" value, trimming surrounding whitespace', () => {
    assert.equal(isBekesCounty('Békés'), true);
    assert.equal(isBekesCounty('  Békés  '), true);
    assert.equal(isBekesCounty('Csongrád-Csanád'), false);
    assert.equal(isBekesCounty(null), false);
    assert.equal(isBekesCounty(undefined), false);
});

test('isBacsKiskunCounty matches only an exact "Bács-Kiskun" value, trimming surrounding whitespace', () => {
    assert.equal(isBacsKiskunCounty('Bács-Kiskun'), true);
    assert.equal(isBacsKiskunCounty('  Bács-Kiskun  '), true);
    assert.equal(isBacsKiskunCounty('Békés'), false);
    assert.equal(isBacsKiskunCounty(null), false);
    assert.equal(isBacsKiskunCounty(undefined), false);
});

test('Bacs-Kiskun pickup range stays within the same month', () => {
    const info = getBacsKiskunPickupRangeInfo('2026-10-06');
    assert.equal(info.cuttingDayLabel, 'október 6.');
    assert.equal(info.rangeLabel, 'október 6. – 7.');
});

test('Bacs-Kiskun pickup range crosses a month boundary using real date arithmetic', () => {
    const info = getBacsKiskunPickupRangeInfo('2026-10-31');
    assert.equal(info.cuttingDayLabel, 'október 31.');
    assert.equal(info.rangeLabel, 'október 31. – november 1.');
});

test('Bacs-Kiskun pickup range crosses a year boundary using real date arithmetic', () => {
    const info = getBacsKiskunPickupRangeInfo('2026-12-31');
    assert.equal(info.cuttingDayLabel, 'december 31.');
    assert.equal(info.rangeLabel, 'december 31. – január 1.');
});
