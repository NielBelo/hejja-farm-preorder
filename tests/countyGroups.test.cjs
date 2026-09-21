const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/countyGroups.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const countyGroupsModule = { exports: {} };
new Function('exports', compiled)(countyGroupsModule.exports);
const { getCountyGroup, isBekesCounty, isBacsKiskunCounty } = countyGroupsModule.exports;

test('getCountyGroup classifies Bekes county', () => {
    assert.equal(getCountyGroup('Békés'), 'bekes');
    assert.equal(getCountyGroup('  Békés  '), 'bekes');
});

test('getCountyGroup classifies Bacs-Kiskun county', () => {
    assert.equal(getCountyGroup('Bács-Kiskun'), 'bacsKiskun');
    assert.equal(getCountyGroup('  Bács-Kiskun  '), 'bacsKiskun');
});

test('getCountyGroup treats every other value (including missing) as "other"', () => {
    assert.equal(getCountyGroup('Csongrád-Csanád'), 'other');
    assert.equal(getCountyGroup(null), 'other');
    assert.equal(getCountyGroup(undefined), 'other');
    assert.equal(getCountyGroup(''), 'other');
});

test('isBekesCounty/isBacsKiskunCounty are mutually exclusive and delegate to getCountyGroup', () => {
    assert.equal(isBekesCounty('Békés'), true);
    assert.equal(isBacsKiskunCounty('Békés'), false);
    assert.equal(isBekesCounty('Bács-Kiskun'), false);
    assert.equal(isBacsKiskunCounty('Bács-Kiskun'), true);
});
