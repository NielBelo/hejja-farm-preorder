const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath, imports = {}) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', compiled)(exports, (name) => {
        if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
        return imports[name];
    });
    return exports;
}

const { getReminderOrderTargetsForDate } = load('../lib/email/reminderData.ts', {
    '@/lib/countyGroups': { isBacsKiskunCounty: () => false },
    '@/lib/email/orderNotificationData': {
        loadOrderNotificationData: async () => null,
        loadSeasonProductPrices: async () => new Map(),
        notificationOrderSelect: '',
        seasonPriceKey: () => '',
    },
});

// A hamis lekérdezés rögzíti a szűrőket és a kiválasztott mezőket.
function fakeSupabase(rows) {
    const calls = { select: '', is: [], eq: [] };
    const chain = {
        select(columns) { calls.select = columns; return chain; },
        eq(column, value) { calls.eq.push([column, value]); return chain; },
        is(column, value) { calls.is.push([column, value]); return chain; },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return { calls, from: () => chain };
}

test('az emlékeztető célpontjai kizárják az archivált szezon rendeléseit, az aktivitást nem vizsgálják', async () => {
    const supabase = fakeSupabase([{ id: 5, pickup_day_id: 9 }]);
    const targets = await getReminderOrderTargetsForDate(supabase, '2026-12-01');
    assert.deepEqual(targets, [{ orderId: 5, pickupDayId: 9 }]);
    assert.match(supabase.calls.select, /season_parameters!orders_season_parameter_id_fkey!inner\(archived_at\)/);
    assert.deepEqual(supabase.calls.is, [['archived_at', null], ['season_parameters.archived_at', null]]);
    assert.ok(!JSON.stringify(supabase.calls).includes('is_active'), 'az aktivitás nem szűrő');
    assert.deepEqual(supabase.calls.eq, [['status', 'submitted'], ['pickup_days.pickup_date', '2026-12-01'], ['pickup_days.kind', 'normal']]);
});
