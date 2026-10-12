const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, require);
    return exports;
}

const { isOrderInActiveSeason, canChangeOrder } = load('../lib/orderHistoryAccess.ts');

test('a missing order season or missing active season is never the active season', () => {
    assert.equal(isOrderInActiveSeason(null, 5), false);
    assert.equal(isOrderInActiveSeason(undefined, 5), false);
    assert.equal(isOrderInActiveSeason(5, null), false);
    assert.equal(isOrderInActiveSeason(5, undefined), false);
});

test('an order from an older/inactive season is not in the active season', () => {
    assert.equal(isOrderInActiveSeason(3, 5), false);
});

test('an order from the active season is in the active season', () => {
    assert.equal(isOrderInActiveSeason(5, 5), true);
});

test('changes are allowed only when pickup is current, the season is active AND the window is open', () => {
    assert.equal(canChangeOrder({ isPickupCurrent: true, isActiveSeason: true, isWindowOpen: true }), true);
});

test('an expired preorder window blocks changes even for the active season and a current pickup', () => {
    assert.equal(canChangeOrder({ isPickupCurrent: true, isActiveSeason: true, isWindowOpen: false }), false);
});

test('an inactive/older season blocks changes even with an open window', () => {
    assert.equal(canChangeOrder({ isPickupCurrent: true, isActiveSeason: false, isWindowOpen: true }), false);
});

test('a past pickup date blocks changes', () => {
    assert.equal(canChangeOrder({ isPickupCurrent: false, isActiveSeason: true, isWindowOpen: true }), false);
});
