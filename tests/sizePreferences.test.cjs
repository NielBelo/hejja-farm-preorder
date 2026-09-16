const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/sizePreferences.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
new Function('exports', 'require', compiled)(moduleExports, require);

test('only the three approved size preferences are selectable', () => {
    assert.deepEqual(moduleExports.SIZE_PREFERENCES, [
        'Átlagos méret',
        'Átlagostól kisebb méret',
        'Átlagostól nagyobb méret',
    ]);
});

test('normalizes legacy size preferences for existing orders', () => {
    assert.equal(moduleExports.normalizeSizePreference('Átlagos méret megfelelő'), 'Átlagos méret');
    assert.equal(moduleExports.normalizeSizePreference('Átlagostól inkább kisebbet kérek, ha lehet'), 'Átlagostól kisebb méret');
    assert.equal(moduleExports.normalizeSizePreference('Átlagostól inkább nagyobbat kérek, ha lehet'), 'Átlagostól nagyobb méret');
});
