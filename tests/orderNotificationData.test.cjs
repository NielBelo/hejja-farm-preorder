const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, require);
    return exports;
}

const { loadOrderNotificationData } = load('../lib/email/orderNotificationData.ts');

const ORDER = {
    id: 7,
    user_id: 'u-7',
    season_parameter_id: 1,
    public_order_number: 'HO-0007',
    pickup_days: { pickup_date: '2026-10-05' },
    current_version: {
        order_items: [{ quantity: 2, size_preference: null, note: null, products: { name: 'Tojás' }, packages: { name: 'Doboz' } }],
    },
};
const PROFILE = { first_name: 'Anna', last_name: 'Kiss', email: 'profile@example.hu', county: 'Békés' };
const SEASON = {
    time_window_start: '2026-09-01T00:00:00Z',
    time_window_end: '2026-10-01T00:00:00Z',
    pickup_time_start: '08:00',
    pickup_time_end: '12:00',
    local_pickup_time_start: '09:00',
};

// Szimulált Supabase-kliens: rögzíti a getUser-hívásokat és a lekérdezések
// szűrőit. A getUser alapértelmezése a service role viselkedését utánozza
// (nincs session -> AuthSessionMissingError), és hívás esetén a teszt is
// megbukik, ha a service role útvonalon mégis lefut.
function fakeSupabase({ getUser, adminRole = null } = {}) {
    const state = { getUserCalls: 0, queries: [] };
    const responses = {
        user_roles: () => ({ data: adminRole, error: null }),
        orders: () => ({ data: ORDER, error: null }),
        profiles: () => ({ data: PROFILE, error: null }),
        season_parameters: () => ({ data: SEASON, error: null }),
    };

    return {
        state,
        auth: {
            getUser: async () => {
                state.getUserCalls += 1;
                return getUser
                    ? getUser()
                    : { data: { user: null }, error: new Error('Auth session missing!') };
            },
        },
        from(table) {
            const query = { table, filters: [] };
            state.queries.push(query);
            const chain = {
                select() { return chain; },
                eq(column, value) { query.filters.push([column, value]); return chain; },
                single: async () => responses[table](),
                maybeSingle: async () => responses[table](),
            };
            return chain;
        },
    };
}

const SESSION_USER = { data: { user: { id: 'u-9', email: 'session@example.hu' } }, error: null };

test('hotfix 1: serviceRole + asAdmin never calls auth.getUser and uses the profile email', async () => {
    const supabase = fakeSupabase();

    const loaded = await loadOrderNotificationData(supabase, { orderId: 7 }, 'created', { asAdmin: true, serviceRole: true });

    assert.equal(supabase.state.getUserCalls, 0, 'auth.getUser must not run on the service-role path');
    assert.equal(loaded.recipient, 'profile@example.hu');
    assert.equal(loaded.data.orderNumber, 'HO-0007');
    const ordersQuery = supabase.state.queries.find((q) => q.table === 'orders');
    assert.equal(ordersQuery.filters.some(([column]) => column === 'user_id'), false, 'service-role lookup must not filter by a session user');
    assert.equal(supabase.state.queries.some((q) => q.table === 'user_roles'), false, 'no session means no admin-role check');
});

test('hotfix 2: the session path still calls auth.getUser and uses the session user', async () => {
    const supabase = fakeSupabase({ getUser: async () => SESSION_USER });

    const loaded = await loadOrderNotificationData(supabase, { orderId: 7 }, 'created');

    assert.equal(supabase.state.getUserCalls, 1);
    assert.equal(loaded.recipient, 'session@example.hu');
    const ordersQuery = supabase.state.queries.find((q) => q.table === 'orders');
    assert.deepEqual(ordersQuery.filters, [['user_id', 'u-9'], ['id', 7]]);
});

test('hotfix 2b: the admin preview (session + asAdmin) still checks the admin role via auth.getUser', async () => {
    const supabase = fakeSupabase({
        getUser: async () => ({ data: { user: { id: 'admin-1', email: 'admin@example.hu' } }, error: null }),
        adminRole: { role: 'admin' },
    });

    const loaded = await loadOrderNotificationData(supabase, { orderId: 7 }, 'created', { asAdmin: true });

    assert.equal(supabase.state.getUserCalls, 1);
    assert.equal(supabase.state.queries.some((q) => q.table === 'user_roles'), true);
    assert.equal(loaded.recipient, 'profile@example.hu');
});

test('hotfix 2c: the admin preview without the admin role still fails', async () => {
    const supabase = fakeSupabase({
        getUser: async () => ({ data: { user: { id: 'u-1', email: 'x@example.hu' } }, error: null }),
        adminRole: null,
    });

    await assert.rejects(
        loadOrderNotificationData(supabase, { orderId: 7 }, 'created', { asAdmin: true }),
        /adminisztrátori jogosultság/,
    );
});

test('hotfix 2d: a session path without a user still fails with the e-mail error', async () => {
    const supabase = fakeSupabase({ getUser: async () => ({ data: { user: null }, error: new Error('Auth session missing!') }) });

    await assert.rejects(
        loadOrderNotificationData(supabase, { orderId: 7 }, 'created'),
        /e-mail-cím nem érhető el/,
    );
});

test('hotfix 1b: serviceRole without asAdmin is rejected before any query runs', async () => {
    const supabase = fakeSupabase();

    await assert.rejects(
        loadOrderNotificationData(supabase, { orderId: 7 }, 'created', { serviceRole: true }),
        /csak asAdmin/,
    );
    assert.equal(supabase.state.getUserCalls, 0);
    assert.equal(supabase.state.queries.length, 0);
});
