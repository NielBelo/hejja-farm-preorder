const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../worker/keepAlive.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'require', compiled)(mod.exports, require);
const { pingSupabase } = mod.exports;

test('sends an authenticated read to the products table', async () => {
    let seen;
    const result = await pingSupabase('https://x.supabase.co', 'key', async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200 };
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(seen.url, 'https://x.supabase.co/rest/v1/products?select=id&limit=1');
    assert.equal(seen.init.headers.apikey, 'key');
});

test('reports a non-2xx status without throwing', async () => {
    const result = await pingSupabase('https://x.supabase.co', 'key', async () => ({ ok: false, status: 401 }));
    assert.deepEqual(result, { ok: false, reason: 'HTTP 401' });
});

test('reports a network error without throwing', async () => {
    const result = await pingSupabase('https://x.supabase.co', 'key', async () => {
        throw new Error('boom');
    });
    assert.deepEqual(result, { ok: false, reason: 'boom' });
});

test('skips the request when URL or key is missing', async () => {
    let called = false;
    const fetchImpl = async () => {
        called = true;
        return { ok: true, status: 200 };
    };
    assert.equal((await pingSupabase(undefined, 'key', fetchImpl)).ok, false);
    assert.equal((await pingSupabase('https://x.supabase.co', undefined, fetchImpl)).ok, false);
    assert.equal(called, false);
});

const { touchKeepAlive } = mod.exports;

test('touchKeepAlive upserts the single keepalive row with the service role key', async () => {
    let seen;
    const now = new Date('2026-11-29T07:00:00.000Z');
    const result = await touchKeepAlive('https://x.supabase.co', 'srk', now, async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 201 };
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(seen.url, 'https://x.supabase.co/rest/v1/keepalive?on_conflict=id');
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.headers.apikey, 'srk');
    assert.match(seen.init.headers.Prefer, /merge-duplicates/);
    assert.deepEqual(JSON.parse(seen.init.body), { id: 1, last_ping: '2026-11-29T07:00:00.000Z' });
});

test('touchKeepAlive reports failures without throwing', async () => {
    assert.deepEqual(
        await touchKeepAlive('https://x.supabase.co', 'srk', new Date(), async () => ({ ok: false, status: 404 })),
        { ok: false, reason: 'HTTP 404' },
    );
    assert.deepEqual(
        await touchKeepAlive('https://x.supabase.co', 'srk', new Date(), async () => {
            throw new Error('boom');
        }),
        { ok: false, reason: 'boom' },
    );
    assert.equal((await touchKeepAlive('https://x.supabase.co', undefined)).ok, false);
});
