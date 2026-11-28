const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/loginErrors.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', compiled)(mod.exports);
const { getLoginFailure, LOGIN_GENERIC_ERROR, LOGIN_UNKNOWN_EMAIL_ERROR } = mod.exports;

test('a nem létező e-mail-cím külön figyelmeztetést kap, az e-mail mezőhöz kötve', () => {
    assert.deepEqual(getLoginFailure(false), { field: 'email', message: LOGIN_UNKNOWN_EMAIL_ERROR });
});

test('létező címnél az általános hibaüzenet marad (rossz jelszó)', () => {
    assert.deepEqual(getLoginFailure(true), { field: 'form', message: LOGIN_GENERIC_ERROR });
});

test('ha az ellenőrzés nem sikerült, az általános hibaüzenet marad', () => {
    assert.deepEqual(getLoginFailure(null), { field: 'form', message: LOGIN_GENERIC_ERROR });
});
