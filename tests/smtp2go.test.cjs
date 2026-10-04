const { test, beforeEach, afterEach } = require('node:test');
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

const {
    sendSmtp2GoEmail,
    isSmtp2GoUncertainError,
    Smtp2GoConfigurationError,
    Smtp2GoDeliveryError,
    Smtp2GoUncertainDeliveryError,
} = load('../lib/email/smtp2go.ts');

const MAIL = { to: 'x@example.hu', subject: 's', text: 't', html: '<p>h</p>' };

let originalFetch;
let originalKey;

beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalKey = process.env.SMTP2GO_API_KEY;
    process.env.SMTP2GO_API_KEY = 'test-key';
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SMTP2GO_API_KEY;
    else process.env.SMTP2GO_API_KEY = originalKey;
});

function stubFetch(impl) {
    globalThis.fetch = async (...args) => impl(...args);
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// 1. SMTP2GO explicit reject -> failed (Smtp2GoDeliveryError, NEM uncertain)
test('1: an explicit SMTP2GO rejection (HTTP 422) is a failed delivery, not uncertain', async () => {
    stubFetch(async () => jsonResponse(422, { request_id: 'r1', data: { error: 'invalid sender' } }));

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => {
        assert.ok(error instanceof Smtp2GoDeliveryError);
        assert.equal(isSmtp2GoUncertainError(error), false);
        return true;
    });
});

test('1b: an explicit rejection in a 200 body (failed > 0, succeeded = 0) is a failed delivery', async () => {
    stubFetch(async () => jsonResponse(200, { request_id: 'r2', data: { succeeded: 0, failed: 1, failures: ['bad'] } }));

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => {
        assert.ok(error instanceof Smtp2GoDeliveryError);
        assert.equal(isSmtp2GoUncertainError(error), false);
        return true;
    });
});

// 2. Network / timeout -> uncertain
test('2: a network error (connection reset) is uncertain, never failed', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed'); });

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => {
        assert.ok(error instanceof Smtp2GoUncertainDeliveryError);
        assert.equal(isSmtp2GoUncertainError(error), true);
        return true;
    });
});

test('2b: a timeout (AbortError) is uncertain', async () => {
    stubFetch(async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); });

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => isSmtp2GoUncertainError(error));
});

test('2c: a 5xx response is uncertain (the provider may have accepted the message)', async () => {
    stubFetch(async () => jsonResponse(503, { error: 'unavailable' }));

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => isSmtp2GoUncertainError(error));
});

test('2d: a 200 response with an unreadable body is uncertain', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => isSmtp2GoUncertainError(error));
});

test('2e: a 200 response with neither succeeded nor failed is uncertain, not accepted', async () => {
    stubFetch(async () => jsonResponse(200, { request_id: 'r3', data: {} }));

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => isSmtp2GoUncertainError(error));
});

// Helyes elfogadás és lokális, küldés előtti hiba.
test('success: a 200 response with succeeded >= 1 returns the provider id', async () => {
    stubFetch(async () => jsonResponse(200, { request_id: 'r4', data: { succeeded: 1, failed: 0, email_id: 'em-42' } }));

    const delivery = await sendSmtp2GoEmail(MAIL);
    assert.deepEqual(delivery, { id: 'em-42' });
});

test('local: a missing API key is a configuration error before any request (failed, not uncertain)', async () => {
    delete process.env.SMTP2GO_API_KEY;
    let fetchCalled = false;
    stubFetch(async () => { fetchCalled = true; return jsonResponse(200, {}); });

    await assert.rejects(sendSmtp2GoEmail(MAIL), (error) => {
        assert.ok(error instanceof Smtp2GoConfigurationError);
        assert.equal(isSmtp2GoUncertainError(error), false);
        return true;
    });
    assert.equal(fetchCalled, false);
});
