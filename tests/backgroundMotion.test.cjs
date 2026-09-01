const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/backgroundMotion.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const motionModule = { exports: {} };
new Function('exports', compiled)(motionModule.exports);
const { getBackgroundMotion } = motionModule.exports;

test('background follows the first 40 percent of a viewport', () => {
    assert.deepEqual(getBackgroundMotion(0, 1000), { offset: 0, settled: false });
    assert.deepEqual(getBackgroundMotion(200, 1000), { offset: 200, settled: false });
});

test('background stops at the travel boundary', () => {
    assert.deepEqual(getBackgroundMotion(400, 1000), { offset: 400, settled: true });
    assert.deepEqual(getBackgroundMotion(1600, 1000), { offset: 400, settled: true });
});

test('scrolling back above the boundary releases the background', () => {
    const motion = getBackgroundMotion(360, 1000);
    assert.equal(motion.settled, false);
    assert.ok(motion.offset > 360 && motion.offset < 400);
});

test('deceleration is continuous and becomes stronger near the boundary', () => {
    const beforeCurve = getBackgroundMotion(219, 1000).offset;
    const curveStart = getBackgroundMotion(220, 1000).offset;
    const nearBoundary = getBackgroundMotion(390, 1000).offset;
    assert.ok(Math.abs((curveStart - beforeCurve) - 1) < 0.05);
    assert.ok(400 - nearBoundary < 10);
});

test('negative scroll is clamped and reduced motion disables movement', () => {
    assert.deepEqual(getBackgroundMotion(-20, 1000), { offset: 0, settled: false });
    assert.deepEqual(getBackgroundMotion(800, 1000, true), { offset: 0, settled: false });
});
