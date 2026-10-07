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

const KEY = 'test-service-role-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

let processed = null;
const route = load('../worker/reminderChunk.ts', {
    '@supabase/supabase-js': require('@supabase/supabase-js'),
    '../lib/email/sendReminderEmail': {
        isReminderSendingBlocked: () => false,
        processReminderChunk: async (_sb, targets) => {
            processed = targets;
            return targets.map((t) => ({ kind: 'sent', orderId: t.orderId }));
        },
    },
});

test('a chunk endpoint rejects requests without the service role Bearer token', async () => {
    const response = await route.handleReminderChunkRequest(new Request('https://example.test/__internal/reminder-chunk', {
        method: 'POST',
        body: JSON.stringify({ targets: [], runAt: new Date().toISOString() }),
    }));
    assert.equal(response.status, 403);
    assert.equal(processed, null, 'nothing may be processed without auth');
});

test('a chunk endpoint with the right token processes the chunk and returns its outcomes', async () => {
    processed = null;
    const response = await route.handleReminderChunkRequest(new Request('https://example.test/__internal/reminder-chunk', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ targets: [{ orderId: 9, pickupDayId: 100 }], runAt: new Date().toISOString() }),
    }));
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.deepEqual(json.outcomes, [{ kind: 'sent', orderId: 9 }]);
    assert.deepEqual(processed, [{ orderId: 9, pickupDayId: 100 }]);
});

test('the runner sends the chunk with the service Bearer token and returns the outcomes', async () => {
    let seen = null;
    const runner = route.createReminderChunkRunner({
        fetch: async (request) => {
            seen = { auth: request.headers.get('authorization'), body: await request.json(), path: new URL(request.url).pathname };
            return Response.json({ outcomes: [{ kind: 'skipped' }] });
        },
    });
    const outcomes = await runner([{ orderId: 4, pickupDayId: 100 }], new Date('2026-10-06T06:00:00Z'));
    assert.deepEqual(outcomes, [{ kind: 'skipped' }]);
    assert.equal(seen.auth, `Bearer ${KEY}`);
    assert.equal(seen.path, '/__internal/reminder-chunk');
    assert.deepEqual(seen.body.targets, [{ orderId: 4, pickupDayId: 100 }]);
});

test('the runner throws on a non-2xx response so the caller can retry or report the chunk', async () => {
    const runner = route.createReminderChunkRunner({
        fetch: async () => new Response('boom', { status: 500 }),
    });
    await assert.rejects(runner([{ orderId: 4, pickupDayId: 100 }], new Date()), /HTTP 500/);
});
