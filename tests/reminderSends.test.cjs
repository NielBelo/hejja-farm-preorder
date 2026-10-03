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

const { claimReminderSend, finalizeReminderSend } = load('../lib/email/reminderSends.ts');

function fakeSupabase(rpcImpl) {
    const calls = [];
    return {
        calls,
        rpc: async (name, params) => {
            calls.push({ name, params });
            return rpcImpl(name, params);
        },
    };
}

test('claimReminderSend calls the public.claim_reminder_send RPC with the right params', async () => {
    const supabase = fakeSupabase(() => ({
        data: [{ id: 7, claimed: true, status: 'sending', attempted_at: '2026-10-06T08:00:00Z' }],
        error: null,
    }));
    const claim = await claimReminderSend(supabase, 42, 9);

    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0].name, 'claim_reminder_send');
    assert.deepEqual(supabase.calls[0].params, { p_order_id: 42, p_pickup_day_id: 9 });
    assert.deepEqual(claim, { id: 7, claimed: true, status: 'sending', attemptedAt: '2026-10-06T08:00:00Z' });
});

test('claimReminderSend handles a single-object RPC response (not wrapped in an array)', async () => {
    const supabase = fakeSupabase(() => ({
        data: { id: 3, claimed: false, status: 'sent', attempted_at: '2026-10-05T07:00:00Z' },
        error: null,
    }));
    const claim = await claimReminderSend(supabase, 1, 1);
    assert.deepEqual(claim, { id: 3, claimed: false, status: 'sent', attemptedAt: '2026-10-05T07:00:00Z' });
});

test('claimReminderSend maps a missing/null attempted_at to null (never undefined)', async () => {
    const supabase = fakeSupabase(() => ({ data: [{ id: 1, claimed: true, status: 'sending', attempted_at: null }], error: null }));
    const claim = await claimReminderSend(supabase, 1, 1);
    assert.equal(claim.attemptedAt, null);
});

test('claimReminderSend throws a descriptive error when the RPC fails', async () => {
    const supabase = fakeSupabase(() => ({ data: null, error: { message: 'connection refused' } }));
    await assert.rejects(claimReminderSend(supabase, 1, 1), /connection refused/);
});

test('claimReminderSend throws when the RPC returns no row at all', async () => {
    const supabase = fakeSupabase(() => ({ data: [], error: null }));
    await assert.rejects(claimReminderSend(supabase, 1, 1));
});

test('finalizeReminderSend("sent") passes the provider message id and no error message', async () => {
    const supabase = fakeSupabase(() => ({ data: null, error: null }));
    await finalizeReminderSend(supabase, 7, { status: 'sent', providerMessageId: 'msg-123' });

    assert.equal(supabase.calls[0].name, 'finalize_reminder_send');
    assert.deepEqual(supabase.calls[0].params, {
        p_id: 7,
        p_status: 'sent',
        p_provider_message_id: 'msg-123',
        p_error_message: null,
    });
});

test('finalizeReminderSend("failed") passes the error message and no provider message id', async () => {
    const supabase = fakeSupabase(() => ({ data: null, error: null }));
    await finalizeReminderSend(supabase, 7, { status: 'failed', errorMessage: 'SMTP2GO 500' });

    assert.deepEqual(supabase.calls[0].params, {
        p_id: 7,
        p_status: 'failed',
        p_provider_message_id: null,
        p_error_message: 'SMTP2GO 500',
    });
});

test('finalizeReminderSend truncates an overly long error message to 500 characters', async () => {
    const supabase = fakeSupabase(() => ({ data: null, error: null }));
    const longMessage = 'x'.repeat(2000);
    await finalizeReminderSend(supabase, 7, { status: 'failed', errorMessage: longMessage });
    assert.equal(supabase.calls[0].params.p_error_message.length, 500);
});

test('finalizeReminderSend throws a descriptive error when the RPC fails', async () => {
    const supabase = fakeSupabase(() => ({ data: null, error: { message: 'row not found' } }));
    await assert.rejects(finalizeReminderSend(supabase, 7, { status: 'sent', providerMessageId: 'm' }), /row not found/);
});
