const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// A lib/email modulokat (relatív importokkal együtt) CommonJS-ként tölti be, a "server-only" import nélkül.
const cache = {};
function load(name) {
    if (cache[name]) return cache[name].exports;
    const source = fs.readFileSync(path.join(__dirname, '../lib/email', `${name}.ts`), 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} };
    cache[name] = mod;
    new Function('exports', 'require', 'module', compiled)(mod.exports, (id) => load(id.replace('./', '')), mod);
    return mod.exports;
}
const shared = load('emailLogShared');
const { toEmailLogRow } = load('smtp2goActivity');
const { toResendRow, fetchResendRows } = load('resendActivity');
const { searchEmailLog } = load('emailLog');

const smtp = (id, date, event, extra = {}) => ({ email_id: id, date, event, recipient: `${id}@example.com`, subject: 'S', ...extra });
const resend = (id, created_at, last_event, to = [`${id}@example.com`]) => ({ id, created_at, last_event, to, subject: 'R' });
const smtpRow = (...args) => toEmailLogRow(smtp(...args));
const resendRow = (...args) => toResendRow(resend(...args));

test('SMTP2GO: processed nem kézbesített, opened kézbesített, hiba okkal', () => {
    assert.equal(smtpRow('a', '2026-10-14T10:00:00Z', 'processed').statusLabel, 'Feldolgozás alatt');
    assert.equal(smtpRow('a', '2026-10-14T10:00:00Z', 'opened').statusLabel, 'Kézbesítve');
    const bounced = smtpRow('a', '2026-10-14T10:00:00Z', 'hard-bounced', { reason: 'No such user' });
    assert.equal(bounced.tone, 'error');
    assert.equal(bounced.detail, 'No such user');
    assert.equal(bounced.provider, 'smtp2go');
});

test('Resend: sent/queued nem kézbesített; opened/clicked kézbesített; complained nem sikertelen', () => {
    const r = (event) => resendRow('r', '2026-10-14T10:00:00Z', event);
    assert.equal(r('sent').statusLabel, 'Elküldve');
    assert.equal(r('sent').group, 'processing');
    assert.equal(r('queued').group, 'processing');
    assert.equal(r('delivered').group, 'delivered');
    assert.equal(r('opened').group, 'delivered');
    assert.equal(r('clicked').group, 'delivered');
    assert.equal(r('complained').group, 'spam');
    assert.equal(r('delivery_delayed').statusLabel, 'Késleltetve');
    assert.equal(r('bounced').statusLabel, 'Visszapattant');
    assert.equal(r('failed').statusLabel, 'Sikertelen');
    assert.equal(r('mystery').statusLabel, 'Egyéb (mystery)');
    assert.equal(r('mystery').rawStatus, 'mystery');
});

test('Resend: Postgres-stílusú időbélyeg és több címzett', () => {
    const r = resendRow('r', '2026-10-14 22:36:37.123456+00', 'delivered', ['a@x.hu', 'b@x.hu']);
    assert.equal(r.date, '2026-10-14T22:36:37.123Z');
    assert.equal(r.recipient, 'a@x.hu, b@x.hu');
    assert.equal(toResendRow({ id: 'x', created_at: 'nem dátum' }), null);
});

test('közös lapozás: nincs kihagyott és duplikált sor, a sorrend időrendi', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) rows.push(smtpRow(`s${i}`, new Date(Date.UTC(2026, 9, 14, 10, 0, (i * 7) % 50)).toISOString(), 'delivered'));
    for (let i = 0; i < 40; i++) rows.push(resendRow(`r${i}`, new Date(Date.UTC(2026, 9, 14, 10, 0, (i * 5) % 50)).toISOString(), 'sent'));
    const expected = [...rows].sort(shared.compareRows).map((r) => r.id);

    const seen = [];
    let cursor = { g: null, r: null };
    for (let guard = 0; guard < 10; guard++) {
        const page = shared.buildPage(rows, cursor, []);
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextToken) break;
        cursor = shared.decodeCursor(page.nextToken);
    }
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, 80);
});

test('kurzor: érvénytelen token elutasítva', () => {
    assert.equal(shared.decodeCursor('{rossz'), null);
    assert.equal(shared.decodeCursor('{"g":{"t":"x","id":1}}'), null);
    assert.deepEqual(shared.decodeCursor(undefined), { g: null, r: null });
});

function withFetch(handler, fn) {
    const original = global.fetch;
    const calls = [];
    global.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init); };
    process.env.SMTP2GO_API_KEY = 'k1';
    process.env.RESEND_API_KEY = 'k2';
    return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Resend: after kurzorral lapoz, szűr, és a kellő számú találat után megáll', async () => {
    // 3 kérés * 100 levél, minden 10. címzettje "keres@x.hu"
    const all = Array.from({ length: 300 }, (_, i) => resend(`r${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 9, 14, 12) - i * 1000).toISOString(), 'delivered', [i % 10 === 0 ? 'keres@x.hu' : 'mas@x.hu']));
    await withFetch((url) => {
        const params = new URL(url).searchParams;
        const start = params.get('after') ? all.findIndex((e) => e.id === params.get('after')) + 1 : 0;
        return jsonResponse({ has_more: start + 100 < all.length, data: all.slice(start, start + 100) });
    }, async (calls) => {
        const result = await fetchResendRows({ recipient: 'KERES', cursor: { g: null, r: null } });
        assert.equal(result.rows.length, 30);
        assert.equal(calls.length, 3);
        assert.ok(calls[1].includes('after=r099'));
        assert.equal(result.truncated, false);
    });
});

test('Resend: kérésplafon után csonkoltnak jelzi', async () => {
    let n = 0;
    const page = () => Array.from({ length: 100 }, (_, i) => resend(`p${n}-${i}`, '2026-10-14T10:00:00Z', 'delivered', ['mas@x.hu']));
    await withFetch(() => { n++; return jsonResponse({ has_more: true, data: page() }); }, async (calls) => {
        const result = await fetchResendRows({ recipient: 'nincs', cursor: { g: null, r: null } });
        assert.equal(calls.length, 5);
        assert.equal(result.truncated, true);
        assert.equal(result.rows.length, 0);
    });
});

test('egyik szolgáltató hibája: a másik sorai megjelennek figyelmeztetéssel', async () => {
    await withFetch((url) => {
        if (url.includes('smtp2go')) return jsonResponse({ data: { events: [smtp('a', '2026-10-14T10:00:00Z', 'delivered')] } });
        return jsonResponse({ name: 'restricted_api_key' }, 401);
    }, async () => {
        const page = await searchEmailLog({ cursor: { g: null, r: null } });
        assert.equal(page.rows.length, 1);
        assert.equal(page.rows[0].provider, 'smtp2go');
        assert.equal(page.warnings.length, 1);
        assert.match(page.warnings[0], /Resend/);
        assert.match(page.warnings[0], /hiányos/);
    });
});

test('mindkét szolgáltató hibája hiba; szolgáltatószűrő csak a kért API-t hívja', async () => {
    await withFetch(() => jsonResponse({}, 500), async () => {
        await assert.rejects(searchEmailLog({ cursor: { g: null, r: null } }));
    });
    await withFetch(() => jsonResponse({ has_more: false, data: [resend('r1', '2026-10-14T10:00:00Z', 'sent')] }), async (calls) => {
        const page = await searchEmailLog({ provider: 'resend', cursor: { g: null, r: null } });
        assert.equal(page.rows.length, 1);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].includes('api.resend.com'));
    });
});

test('két szolgáltató közös időrendi listában, szűrők együtt', async () => {
    await withFetch((url) => url.includes('smtp2go')
        ? jsonResponse({ data: { events: [smtp('a', '2026-10-14T10:00:00Z', 'delivered'), smtp('b', '2026-10-14T12:00:00Z', 'processed')] } })
        : jsonResponse({ has_more: false, data: [resend('c', '2026-10-14T11:00:00Z', 'delivered'), resend('d', '2026-10-14T13:00:00Z', 'sent')] }),
    async () => {
        const all = await searchEmailLog({ cursor: { g: null, r: null } });
        assert.deepEqual(all.rows.map((r) => r.id), ['resend:d', 'smtp2go:b', 'resend:c', 'smtp2go:a']);
        const filtered = await searchEmailLog({ status: 'delivered', recipient: 'C@EXAMPLE', cursor: { g: null, r: null } });
        assert.deepEqual(filtered.rows.map((r) => r.id), ['resend:c']);
    });
});

test('végpontok közti lapozás a kurzorokkal: nincs kihagyott/duplikált sor, a Resend after-rel folytat', async () => {
    const smtpEvents = Array.from({ length: 70 }, (_, i) => smtp(`s${i}`, new Date(Date.UTC(2026, 9, 14, 12) - i * 11000).toISOString(), 'delivered'));
    const resendAll = Array.from({ length: 230 }, (_, i) => resend(`r${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 9, 14, 12) - i * 7000).toISOString(), 'sent'));
    await withFetch((url) => {
        if (url.includes('smtp2go')) return jsonResponse({ data: { events: smtpEvents } });
        const params = new URL(url).searchParams;
        const start = params.get('after') ? resendAll.findIndex((e) => e.id === params.get('after')) + 1 : 0;
        return jsonResponse({ has_more: start + 100 < resendAll.length, data: resendAll.slice(start, start + 100) });
    }, async () => {
        const seen = [];
        let cursor = { g: null, r: null };
        for (let guard = 0; guard < 30; guard++) {
            const page = await searchEmailLog({ cursor });
            seen.push(...page.rows.map((r) => r.id));
            if (!page.nextToken) break;
            cursor = shared.decodeCursor(page.nextToken);
        }
        const expected = [...smtpEvents.map((e) => smtpRow(e.email_id, e.date, 'delivered')), ...resendAll.map((e) => resendRow(e.id, e.created_at, 'sent'))].sort(shared.compareRows).map((r) => r.id);
        assert.equal(seen.length, 300);
        assert.deepEqual(seen, expected);
    });
});

test('e-mail típus: a tényleges sablontárgyak, változó rendelésszámmal és márkaváltozatokkal', () => {
    const t = shared.classifyEmailType;
    assert.equal(t('Héjja Ökofarm – rendelés visszaigazolása (HF-2026-0001)'), 'new_order');
    assert.equal(t('Héjja-Farm – rendelés visszaigazolása (12345)'), 'new_order');
    assert.equal(t('Héjja Ökofarm – rendelés módosítva (HF-9)'), 'order_updated');
    assert.equal(t('Héjja-Farm – rendelés módosítva (HF-9)'), 'order_updated');
    assert.equal(t('Héjja Ökofarm – rendelés törölve (#7 / 2026)'), 'order_cancelled');
    assert.equal(t('Héjja Ökofarm – meghívó csirke előrendeléshez'), 'invite');
    assert.equal(t('Héjja-Farm – meghívó csirke előrendeléshez'), 'invite');
    assert.equal(t('Héjja Ökofarm – erősítsd meg az e-mail-címedet'), 'confirmation');
    assert.equal(t('Héjja-Ökofarm – erősítsd meg az e-mail-címedet'), 'confirmation');
    assert.equal(t('Héjja Ökofarm – rendelés átvételi emlékeztető (HF-2026-0001)'), 'reminder');
    assert.equal(t('  HÉJJA ÖKOFARM  –  Rendelés   átvételi emlékeztető (1)'), 'reminder');
    assert.equal(t('Héjja Ökofarm - rendelés törölve (1)'), 'order_cancelled');
});

test('e-mail típus: hasonló, de más levelek az Egyéb kategóriába kerülnek', () => {
    const t = shared.classifyEmailType;
    assert.equal(t('Héjja Ökofarm – emlékeztető futás összesítő (2026. október 8.)'), 'other');
    assert.equal(t('Héjja Ökofarm – Resend teszt'), 'other');
    assert.equal(t('Héjja Ökofarm – rendelés visszaigazolása kérés'), 'other');
    assert.equal(t('Rendelés törölve (12)'), 'other');
    assert.equal(t('Más cég – rendelés törölve (12)'), 'other');
    assert.equal(t('Héjja Ökofarm – rendelés törölve (1) és még valami'), 'other');
    assert.equal(t(''), 'other');
});

test('négy szűrő együtt, mindkét szolgáltatón, és az Egyéb típus', async () => {
    await withFetch((url) => url.includes('smtp2go')
        ? jsonResponse({ data: { events: [
            smtp('a', '2026-10-14T10:00:00Z', 'delivered', { subject: 'Héjja Ökofarm – rendelés átvételi emlékeztető (HF-1)' }),
            smtp('b', '2026-10-14T12:00:00Z', 'delivered', { subject: 'Héjja Ökofarm – emlékeztető futás összesítő (X)' }),
            smtp('c', '2026-10-14T09:00:00Z', 'processed', { subject: 'Héjja Ökofarm – rendelés átvételi emlékeztető (HF-2)' }),
        ] } })
        : jsonResponse({ has_more: false, data: [
            { ...resend('d', '2026-10-14T11:00:00Z', 'delivered'), subject: 'Héjja Ökofarm – rendelés visszaigazolása (HF-3)' },
            { ...resend('e', '2026-10-14T08:00:00Z', 'delivered'), subject: 'Héjja Ökofarm – rendelés átvételi emlékeztető (HF-4)' },
        ] }),
    async () => {
        const base = { cursor: { g: null, r: null } };
        const ids = async (extra) => (await searchEmailLog({ ...base, ...extra })).rows.map((r) => r.id);
        assert.deepEqual(await ids({ type: 'reminder' }), ['smtp2go:a', 'smtp2go:c', 'resend:e']);
        assert.deepEqual(await ids({ type: 'reminder', status: 'delivered' }), ['smtp2go:a', 'resend:e']);
        assert.deepEqual(await ids({ type: 'reminder', status: 'delivered', provider: 'smtp2go' }), ['smtp2go:a']);
        assert.deepEqual(await ids({ type: 'reminder', status: 'delivered', provider: 'smtp2go', recipient: 'A@' }), ['smtp2go:a']);
        assert.deepEqual(await ids({ type: 'reminder', status: 'delivered', provider: 'smtp2go', recipient: 'zzz' }), []);
        assert.deepEqual(await ids({ type: 'new_order' }), ['resend:d']);
        assert.deepEqual(await ids({ type: 'other' }), ['smtp2go:b']);
    });
});

test('típusszűrő a Resend csonkolási figyelmeztetésével együtt működik', async () => {
    const page = () => Array.from({ length: 100 }, (_, i) => ({ ...resend('x' + Math.random() + i, '2026-10-14T10:00:00Z', 'delivered'), subject: 'Héjja Ökofarm – rendelés törölve (1)' }));
    await withFetch(() => jsonResponse({ has_more: true, data: page() }), async (calls) => {
        const result = await searchEmailLog({ type: 'reminder', provider: 'resend', cursor: { g: null, r: null } });
        assert.equal(calls.length, 5);
        assert.equal(result.rows.length, 0);
        assert.equal(result.warnings.length, 1);
        assert.match(result.warnings[0], /csonkolva/);
    });
});

test('mély oldalon (az SMTP2GO ablakán túl) az SMTP2GO-hívás kimarad', async () => {
    const old = Date.now() - 6 * 86_400_000;
    await withFetch(() => jsonResponse({ has_more: false, data: [resend('r1', new Date(old - 1000).toISOString(), 'delivered')] }), async (calls) => {
        const page = await searchEmailLog({ cursor: { g: { t: old, id: 'resend:r0' }, r: 'r0' } });
        assert.equal(page.rows.length, 1);
        assert.equal(calls.length, 1);
        assert.ok(calls[0].includes('api.resend.com'));
    });
    await withFetch((url) => url.includes('smtp2go') ? jsonResponse({ data: { events: [] } }) : jsonResponse({ has_more: false, data: [] }), async (calls) => {
        await searchEmailLog({ cursor: { g: { t: Date.now() - 86_400_000, id: 'x' }, r: null } });
        assert.equal(calls.filter((c) => c.includes('smtp2go')).length, 1);
    });
});

test('Resend: a közös időkeret lejárta után nem indít újabb kérést, csonkoltnak jelez', async () => {
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
        await withFetch(() => { clock += 8000; return jsonResponse({ has_more: true, data: [resend('q' + clock, '2026-10-14T10:00:00Z', 'delivered', ['mas@x.hu'])] }); }, async (calls) => {
            const result = await fetchResendRows({ recipient: 'nincs', cursor: { g: null, r: null } });
            assert.equal(calls.length, 2);
            assert.equal(result.truncated, true);
        });
    } finally {
        Date.now = realNow;
    }
});
