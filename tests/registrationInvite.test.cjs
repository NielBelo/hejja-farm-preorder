const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, require);
    return exports;
}

const { buildRegistrationInvite } = load('../lib/email/registrationInvite.ts');

test('registration invite contains its one-time link in text and HTML', () => {
    const invitationUrl = 'https://hejja-farm.hu/register?invite=secure-token';
    const email = buildRegistrationInvite({ recipientName: 'Ágnes', invitationUrl });
    assert.equal(email.subject, 'Héjja-Farm – meghívó csirke előrendeléshez');
    assert.ok(email.text.includes(invitationUrl));
    assert.ok(email.html.includes(invitationUrl));
    assert.ok(email.html.includes('Regisztráció megkezdése'));
    assert.ok(email.html.includes('csirke-előrendelő oldalára'));
});

test('registration invite escapes recipient HTML', () => {
    const email = buildRegistrationInvite({ recipientName: '<script>', invitationUrl: 'https://hejja-farm.hu/register?invite=a' });
    assert.ok(email.html.includes('Kedves &lt;script&gt;!'));
    assert.equal(email.html.includes('Kedves <script>!'), false);
});
