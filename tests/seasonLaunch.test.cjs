const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, requireOverrides = {}) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (id) => requireOverrides[id] ?? require(id));
    return exports;
}

const orderNotification = { escapeHtml: (v) => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;') };
const { buildSeasonLaunchEmail, formatSeasonLabel } = load('../lib/email/seasonLaunch.ts', {
    '@/lib/email/orderNotification': orderNotification,
});

const data = { year: 2027, season: 'Tavasz', orderStart: '2027-01-15T07:00:00Z', orderEnd: '2027-02-15T19:00:00Z' };

test('season label is natural Hungarian', () => {
    assert.equal(formatSeasonLabel(2027, 'Tavasz'), '2027-es tavaszi szezon');
    assert.equal(formatSeasonLabel(2026, 'Ősz'), '2026-os őszi szezon');
    assert.equal(formatSeasonLabel(2030, 'Tavasz'), '2030-as tavaszi szezon');
});

test('subject and body use dynamic season data and Budapest time', () => {
    const email = buildSeasonLaunchEmail(data);
    assert.equal(email.subject, 'Héjja Ökofarm – indul a 2027-es tavaszi előrendelés!');
    assert.ok(email.html.includes('2027-es tavaszi szezonjára'));
    assert.ok(email.html.includes('2027. január 15.'));
    assert.ok(email.html.includes('8:00'));
    assert.ok(email.html.includes('20:00'));
    assert.ok(email.html.includes('Előrendelés kezdete:'));
    assert.ok(email.html.includes('Előrendelés vége:'));
    assert.ok(email.html.includes('Fontos tudnivalók'));
    assert.ok(email.html.includes('hejjaokofarm@gmail.com'));
});

test('CTA points to the preorder page', () => {
    const email = buildSeasonLaunchEmail(data);
    assert.ok(email.html.includes('href="https://hejja-okofarm.hu/preorder"'));
    assert.ok(email.html.includes('Előrendelés megnyitása'));
    assert.ok(email.text.includes('https://hejja-okofarm.hu/preorder'));
});

test('a different season changes the content', () => {
    const email = buildSeasonLaunchEmail({ year: 2026, season: 'Ősz', orderStart: '2026-08-01T07:00:00Z', orderEnd: '2026-08-31T19:00:00Z' });
    assert.ok(email.subject.includes('2026-os őszi előrendelés'));
    assert.equal(email.html.includes('2027'), false);
});
