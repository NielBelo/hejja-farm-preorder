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
    interpretSmtp2GoResponse,
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
    stubFetch(async () => jsonResponse(200, { data: {} }));

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

// Valódi válaszformátumok értelmezése. A sendSmtp2GoEmail és az admin összesítő ugyanezt a függvényt használja.
test('shape: the standard accepted response (succeeded = 1) is accepted with the email id', () => {
    const result = interpretSmtp2GoResponse(200, { request_id: 'req-1', data: { succeeded: 1, failed: 0, failures: [], email_id: 'em-1' } });
    assert.deepEqual(result, { kind: 'accepted', id: 'em-1' });
});

test('shape: a fastaccept response without the succeeded count but with email_id is accepted', () => {
    const result = interpretSmtp2GoResponse(200, { request_id: 'req-2', data: { email_id: 'em-2' } });
    assert.deepEqual(result, { kind: 'accepted', id: 'em-2' });
});

test('shape: a top-level request_id alone is NOT proof of acceptance -> uncertain', () => {
    const result = interpretSmtp2GoResponse(200, { request_id: 'req-3' });
    assert.equal(result.kind, 'uncertain');
});

test('shape: a request_id together with failed > 0 is rejected, never accepted', () => {
    assert.deepEqual(interpretSmtp2GoResponse(200, { request_id: 'req-8', data: { failed: 1, succeeded: 0 } }), { kind: 'rejected' });
});

test('shape: an explicit error field with an email_id is rejected', () => {
    assert.deepEqual(interpretSmtp2GoResponse(200, { request_id: 'req-9', data: { email_id: 'em-9', error: 'bad' } }), { kind: 'rejected' });
});

test('shape: numeric string counts are still read as a success', () => {
    const result = interpretSmtp2GoResponse(200, { request_id: 'req-4', data: { succeeded: '1', failed: '0', email_id: 'em-4' } });
    assert.deepEqual(result, { kind: 'accepted', id: 'em-4' });
});

test('shape: partial success (succeeded >= 1, failed > 0) is accepted', () => {
    const result = interpretSmtp2GoResponse(200, { request_id: 'req-5', data: { succeeded: 1, failed: 1, email_id: 'em-5' } });
    assert.deepEqual(result, { kind: 'accepted', id: 'em-5' });
});

test('shape: an explicit rejection (failed > 0, succeeded = 0) is rejected', () => {
    assert.deepEqual(interpretSmtp2GoResponse(200, { request_id: 'req-6', data: { succeeded: 0, failed: 1, failures: [{ reason: 'x' }] } }), { kind: 'rejected' });
});

test('shape: an empty body or one without identifiers is uncertain, with keys-only diagnostics', () => {
    const empty = interpretSmtp2GoResponse(200, {});
    assert.equal(empty.kind, 'uncertain');
    assert.match(empty.shape, /top=\[\]/);

    const unknown = interpretSmtp2GoResponse(200, { data: { succeeded: 0, failed: 0, secret: 'a@b.hu' } });
    assert.equal(unknown.kind, 'uncertain');
    assert.doesNotMatch(unknown.shape, /a@b\.hu/, 'diagnostics must never contain values');
});

test('shape: a non-object 2xx body and a 5xx are uncertain; other non-2xx is rejected', () => {
    assert.equal(interpretSmtp2GoResponse(200, null).kind, 'uncertain');
    assert.equal(interpretSmtp2GoResponse(200, 'ok').kind, 'uncertain');
    assert.equal(interpretSmtp2GoResponse(502, { data: { email_id: 'x' } }).kind, 'uncertain');
    assert.equal(interpretSmtp2GoResponse(422, { data: { email_id: 'x' } }).kind, 'rejected');
});

test('shape end-to-end: a fastaccept response over fetch returns the sent id, not uncertain', async () => {
    stubFetch(async () => jsonResponse(200, { request_id: 'req-7', data: { email_id: 'em-7' } }));
    assert.deepEqual(await sendSmtp2GoEmail(MAIL), { id: 'em-7' });
});

// MEGFIGYELT VÁLASZ (kontrollált fastaccept: true próba, HTTP 200). Ez az egyetlen
// igazolt sikeres formátum: NINCS data.succeeded / data.failed, a sikerjelzés a data.email_id.
const OBSERVED_FASTACCEPT_SUCCESS_BODY = {
    request_id: 'bfaeba26-209f-4f12-8909-380b78afefab',
    data: { email_id: '1xDSk8-7tiG0Lhs7a5-cfm3' },
};

test('observed fastaccept success (HTTP 200, data.email_id only) is sent with email_id as provider id', () => {
    assert.deepEqual(
        interpretSmtp2GoResponse(200, OBSERVED_FASTACCEPT_SUCCESS_BODY),
        { kind: 'accepted', id: '1xDSk8-7tiG0Lhs7a5-cfm3' },
    );
});

test('observed fastaccept success over fetch returns the data.email_id, never the request_id', async () => {
    stubFetch(async () => jsonResponse(200, OBSERVED_FASTACCEPT_SUCCESS_BODY));
    assert.deepEqual(await sendSmtp2GoEmail(MAIL), { id: '1xDSk8-7tiG0Lhs7a5-cfm3' });
});

test('observed success shape with an explicit data.error is failed, not sent', () => {
    assert.deepEqual(
        interpretSmtp2GoResponse(200, { request_id: 'x', data: { email_id: '1xDSk8', error: 'rejected after queue' } }),
        { kind: 'rejected' },
    );
});

test('observed success shape with data.failed > 0 and no success is failed', () => {
    assert.deepEqual(
        interpretSmtp2GoResponse(200, { request_id: 'x', data: { email_id: '1xDSk8', succeeded: 0, failed: 1 } }),
        { kind: 'rejected' },
    );
});

test('observed success shape with a 4xx status is failed even if an email_id is present', () => {
    assert.deepEqual(interpretSmtp2GoResponse(400, OBSERVED_FASTACCEPT_SUCCESS_BODY), { kind: 'rejected' });
});

test('a top-level request_id with no data.email_id and no data.succeeded stays uncertain', () => {
    assert.equal(interpretSmtp2GoResponse(200, { request_id: 'bfaeba26-209f-4f12-8909-380b78afefab' }).kind, 'uncertain');
});
