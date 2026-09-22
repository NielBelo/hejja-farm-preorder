const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../lib/maintenance/config.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleExports = {};
new Function('exports', 'require', compiled)(moduleExports, require);

const { isMaintenanceBlocking, buildMaintenanceStatusPayload, DEFAULT_MAINTENANCE_MESSAGE } = moduleExports;

const guest = null;
const normalUser = { isAdmin: false, isSuperAdmin: false };
const admin = { isAdmin: true, isSuperAdmin: false };
const superAdmin = { isAdmin: true, isSuperAdmin: true };

test('inactive maintenance never blocks anyone, regardless of role or bypass setting', () => {
    for (const bypass of [true, false]) {
        const config = { active: false, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: bypass };
        assert.equal(isMaintenanceBlocking(config, guest), false);
        assert.equal(isMaintenanceBlocking(config, normalUser), false);
        assert.equal(isMaintenanceBlocking(config, admin), false);
        assert.equal(isMaintenanceBlocking(config, superAdmin), false);
    }
});

test('active maintenance always blocks guests and normal users, regardless of the admin bypass toggle', () => {
    for (const bypass of [true, false]) {
        const config = { active: true, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: bypass };
        assert.equal(isMaintenanceBlocking(config, guest), true);
        assert.equal(isMaintenanceBlocking(config, normalUser), true);
    }
});

test('active maintenance blocks admins only when the admin bypass toggle is off', () => {
    const bypassOn = { active: true, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: true };
    const bypassOff = { active: true, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: false };
    assert.equal(isMaintenanceBlocking(bypassOn, admin), false);
    assert.equal(isMaintenanceBlocking(bypassOff, admin), true);
});

test('active maintenance never blocks the superadmin, regardless of the admin bypass toggle', () => {
    for (const bypass of [true, false]) {
        const config = { active: true, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: bypass };
        assert.equal(isMaintenanceBlocking(config, superAdmin), false);
    }
});

test('the poll status payload is minimal ({blocked:false} only) when the caller is not blocked', () => {
    const inactive = { active: false, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: true };
    for (const user of [guest, normalUser, admin, superAdmin]) {
        const payload = buildMaintenanceStatusPayload(inactive, user);
        assert.deepEqual(payload, { blocked: false });
        assert.deepEqual(Object.keys(payload), ['blocked']);
    }

    const activeWithBypass = { active: true, endsAt: null, message: DEFAULT_MAINTENANCE_MESSAGE, adminBypass: true };
    assert.deepEqual(buildMaintenanceStatusPayload(activeWithBypass, admin), { blocked: false });
    assert.deepEqual(buildMaintenanceStatusPayload(activeWithBypass, superAdmin), { blocked: false });
});

test('the poll status payload includes the message and end time only when the caller is actually blocked', () => {
    const active = { active: true, endsAt: '2999-01-01T10:00:00.000Z', message: 'Teszt üzenet', adminBypass: true };
    assert.deepEqual(buildMaintenanceStatusPayload(active, normalUser), {
        blocked: true,
        message: 'Teszt üzenet',
        endsAt: '2999-01-01T10:00:00.000Z',
    });
    assert.deepEqual(buildMaintenanceStatusPayload(active, guest), {
        blocked: true,
        message: 'Teszt üzenet',
        endsAt: '2999-01-01T10:00:00.000Z',
    });

    const activeNoBypass = { active: true, endsAt: null, message: 'Teszt üzenet', adminBypass: false };
    assert.deepEqual(buildMaintenanceStatusPayload(activeNoBypass, admin), {
        blocked: true,
        message: 'Teszt üzenet',
        endsAt: null,
    });
});
