const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/adminAccountData.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const data = { exports: {} };
new Function('exports', compiled)(data.exports);
const { filterAccounts, accountName, accountSpecialNeeds } = data.exports;
const accounts = [
    { id: '1', first_name: 'Ágnes', last_name: 'Héjja', email: 'agnes@example.hu', phone: '+36301234567', county: 'Csongrád-Csanád', city: 'Szeged', status: 'registered', role: 'admin', special_size_preference: 'smaller', oroshazi_delivery: false },
    { id: '2', first_name: 'Béla', last_name: 'Kiss', email: 'bela@example.hu', county: 'Pest', status: 'unconfirmed', role: 'user', special_size_preference: null, oroshazi_delivery: true },
    { id: '3', email: 'meghivott@example.hu', county: null, status: 'invited', role: 'user', special_size_preference: null, oroshazi_delivery: false },
];

test('search combines accent-insensitive name and contact terms', () => {
    assert.deepEqual(filterAccounts(accounts, 'HEJJA szeged 1234567', [], [], [], []).map(a => a.id), ['1']);
});
test('filters combine across categories and permit multiple statuses', () => {
    assert.deepEqual(filterAccounts(accounts, '', ['registered', 'unconfirmed'], ['user'], ['Pest'], []).map(a => a.id), ['2']);
    assert.equal(filterAccounts(accounts, '', ['invited'], ['admin'], [], []).length, 0);
});
test('invited users without profiles remain searchable and filterable', () => {
    assert.equal(accountName(accounts[2]), 'meghivott@example.hu');
    assert.deepEqual(filterAccounts(accounts, 'meghivott', [], [], ['__missing'], []).map(a => a.id), ['3']);
});
test('sent invitations have a dedicated, filterable status', () => {
    assert.deepEqual(filterAccounts(accounts, '', ['invited'], [], [], []).map(a => a.id), ['3']);
});
test('cleared filters return every account', () => {
    assert.equal(filterAccounts(accounts, '  ', [], [], [], []).length, 3);
});
test('special needs are derived from size preference and Orosháza delivery', () => {
    assert.deepEqual(accountSpecialNeeds(accounts[0]), ['smaller']);
    assert.deepEqual(accountSpecialNeeds(accounts[1]), ['oroshazi']);
    assert.deepEqual(accountSpecialNeeds(accounts[2]), ['none']);
});
test('special need filter matches any selected need, including "none"', () => {
    assert.deepEqual(filterAccounts(accounts, '', [], [], [], ['smaller']).map(a => a.id), ['1']);
    assert.deepEqual(filterAccounts(accounts, '', [], [], [], ['oroshazi']).map(a => a.id), ['2']);
    assert.deepEqual(filterAccounts(accounts, '', [], [], [], ['none']).map(a => a.id), ['3']);
    assert.deepEqual(filterAccounts(accounts, '', [], [], [], ['smaller', 'oroshazi']).map(a => a.id), ['1', '2']);
});
