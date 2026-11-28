const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/accountDeletion.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'require', compiled)(mod.exports, require);
const { isAccountDeletionConfirmed } = mod.exports;

test('accepts the confirmation word regardless of case and surrounding spaces', () => {
    assert.equal(isAccountDeletionConfirmed('TÖRLÉS'), true);
    assert.equal(isAccountDeletionConfirmed('  törlés '), true);
});

test('rejects anything else', () => {
    assert.equal(isAccountDeletionConfirmed(''), false);
    assert.equal(isAccountDeletionConfirmed('torles'), false);
    assert.equal(isAccountDeletionConfirmed(undefined), false);
    assert.equal(isAccountDeletionConfirmed(42), false);
});
