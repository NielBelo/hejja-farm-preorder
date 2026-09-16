const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, imports = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, relativePath), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (name) => {
        if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
        return imports[name];
    });
    return exports;
}
const validation = load('../lib/adminAccountEdit.ts');
const valid = {
    first_name: ' Ágnes ',
    last_name: 'Héjja',
    phone: '06 30 123 4567',
    county: 'Pest',
    city: 'Budapest',
    role: 'user',
    special_size_preference: null,
    oroshazi_delivery: false,
};

test('normalizes names and phone and returns the permitted account options', () => {
    const { account } = validation.validateAdminAccount(valid);
    assert.equal(account.first_name, 'Ágnes');
    assert.equal(account.phone, '+36301234567');
    assert.equal(account.city, 'Budapest');
    assert.equal(account.role, 'user');
    assert.equal(account.special_size_preference, null);
    assert.equal(account.oroshazi_delivery, false);
});
test('rejects missing required fields, malformed inputs and invalid phones', () => {
    for (const value of [null, {}, { ...valid, first_name: ' ' }, { ...valid, county: '' }, { ...valid, phone: '36 30 123 45678' }, { ...valid, city: 'x'.repeat(101) }, { ...valid, role: 'owner' }, { ...valid, special_size_preference: 'medium' }]) {
        assert.ok(validation.validateAdminAccount(value).error);
    }
});
test('accepts the same separator-tolerant phone format as the customer profile editor', () => {
    const { account } = validation.validateAdminAccount({ ...valid, phone: '+36 (30) 123-4567' });
    assert.equal(account.phone, '+36301234567');
});
test('includes only the supported admin options and ignores unrelated input', () => {
    const result = validation.validateAdminAccount({ ...valid, email: 'other@example.com', role: 'admin', special_size_preference: 'larger', consents: [] });
    assert.deepEqual(Object.keys(result.account).sort(), ['city', 'county', 'first_name', 'last_name', 'oroshazi_delivery', 'phone', 'role', 'special_size_preference']);
    assert.equal(result.account.role, 'admin');
    assert.equal(result.account.special_size_preference, 'larger');
});

function actionFixture({ signedIn = true, admin = true, rpcError = null } = {}) {
    const calls = [];
    const supabase = {
        auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'current-user' } : null } }) },
        from() { return this; }, select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: admin ? { role: 'admin' } : null }),
        rpc: async (...args) => { calls.push(args); return { data: !rpcError, error: rpcError }; },
    };
    const { updateAdminAccount } = load('../app/(protected)/admin/accounts/actions.ts', {
        '@/lib/supabase/server': { createClient: async () => supabase },
        '@/lib/adminAccountEdit': validation,
        'next/cache': { revalidatePath: () => {} },
    });
    return { updateAdminAccount, calls };
}
const targetId = '12345678-1234-1234-1234-123456789abc';
test('unauthenticated and non-admin requests cannot write', async () => {
    for (const config of [{ signedIn: false }, { admin: false }]) {
        const { updateAdminAccount, calls } = actionFixture(config);
        assert.equal((await updateAdminAccount(targetId, valid)).success, false);
        assert.equal(calls.length, 0);
    }
});
test('invalid target or input cannot reach the database mutation', async () => {
    const { updateAdminAccount, calls } = actionFixture();
    assert.equal((await updateAdminAccount('bad-id', valid)).success, false);
    assert.equal((await updateAdminAccount(targetId, {})).success, false);
    assert.equal(calls.length, 0);
});
test('successful save writes validated profile, role and size options to the target user', async () => {
    const { updateAdminAccount, calls } = actionFixture();
    const result = await updateAdminAccount(targetId, { ...valid, role: 'admin' });
    assert.equal(result.success, true);
    assert.deepEqual(calls, [
        ['update_admin_account_profile', { target_user_id: targetId, profile_data: result.account }],
        ['update_admin_oroshazi_delivery', { target_user_id: targetId, enabled: false }],
    ]);
});
test('database errors are not reported as successful saves', async () => {
    const { updateAdminAccount } = actionFixture({ rpcError: { code: 'PGRST202' } });
    assert.equal((await updateAdminAccount(targetId, valid)).success, false);
});
