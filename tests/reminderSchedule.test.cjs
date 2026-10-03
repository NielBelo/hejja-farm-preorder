const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Ugyanaz a mintázat, mint a tests/pickupInfo.test.cjs-ben: egyetlen .ts
// fájlt fordítunk le önmagában (bundlelés nélkül), a relatív require()
// hívásokat pedig a hívó fájl saját könyvtárához képest oldjuk fel, hogy a
// worker/reminderSchedule.ts -> ../lib/orderWindow lánc is működjön.
const cache = new Map();

function loadTsModule(absolutePath) {
    if (cache.has(absolutePath)) {
        return cache.get(absolutePath);
    }

    const source = fs.readFileSync(absolutePath, 'utf8').replace(/^import "server-only";\r?\n/m, '');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} };
    cache.set(absolutePath, mod.exports);

    const dir = path.dirname(absolutePath);
    const localRequire = (specifier) => {
        if (specifier.startsWith('.')) {
            return loadTsModule(path.join(dir, specifier) + '.ts');
        }
        return require(specifier);
    };

    new Function('exports', 'require', compiled)(mod.exports, localRequire);
    return mod.exports;
}

const { shouldRunReminderJob, getTomorrowPickupDateIso } =
    loadTsModule(path.join(__dirname, '../worker/reminderSchedule.ts'));

test('runs at 08:00 Budapest during summer (CEST, UTC+2) - 06:00 UTC cron', () => {
    assert.equal(shouldRunReminderJob(new Date('2026-07-15T06:00:00Z')), true);
});

test('runs at 08:00 Budapest during winter (CET, UTC+1) - 07:00 UTC cron', () => {
    assert.equal(shouldRunReminderJob(new Date('2026-01-15T07:00:00Z')), true);
});

test('skips the 06:00 UTC cron in winter (07:00 Budapest, not yet 08:00)', () => {
    assert.equal(shouldRunReminderJob(new Date('2026-01-15T06:00:00Z')), false);
});

test('skips the 07:00 UTC cron in summer (09:00 Budapest, already past 08:00)', () => {
    assert.equal(shouldRunReminderJob(new Date('2026-07-15T07:00:00Z')), false);
});

test('skips a completely unrelated hour regardless of season', () => {
    assert.equal(shouldRunReminderJob(new Date('2026-07-15T12:00:00Z')), false);
    assert.equal(shouldRunReminderJob(new Date('2026-01-15T12:00:00Z')), false);
});

test('year rollover: December 31 08:00 Budapest -> tomorrow is January 1 of the next year', () => {
    // 2026-12-31 08:00 Budapest (tél, UTC+1) = 2026-12-31T07:00:00Z
    assert.equal(getTomorrowPickupDateIso(new Date('2026-12-31T07:00:00Z')), '2027-01-01');
});

test('month rollover: January 31 08:00 Budapest -> tomorrow is February 1', () => {
    assert.equal(getTomorrowPickupDateIso(new Date('2026-01-31T07:00:00Z')), '2026-02-01');
});

test('DST spring-forward boundary (2026-03-29): the day before still uses the winter offset', () => {
    // 2026-03-28 08:00 Budapest (még CET, UTC+1) = 2026-03-28T07:00:00Z
    assert.equal(shouldRunReminderJob(new Date('2026-03-28T07:00:00Z')), true);
    assert.equal(getTomorrowPickupDateIso(new Date('2026-03-28T07:00:00Z')), '2026-03-29');
});

test('DST spring-forward boundary (2026-03-29): the day itself already uses the summer offset', () => {
    // 2026-03-29 08:00 Budapest (már CEST, UTC+2) = 2026-03-29T06:00:00Z
    assert.equal(shouldRunReminderJob(new Date('2026-03-29T06:00:00Z')), true);
    assert.equal(getTomorrowPickupDateIso(new Date('2026-03-29T06:00:00Z')), '2026-03-30');
});

test('DST fall-back boundary (2026-10-25): the day before still uses the summer offset', () => {
    // 2026-10-24 08:00 Budapest (még CEST, UTC+2) = 2026-10-24T06:00:00Z
    assert.equal(shouldRunReminderJob(new Date('2026-10-24T06:00:00Z')), true);
    assert.equal(getTomorrowPickupDateIso(new Date('2026-10-24T06:00:00Z')), '2026-10-25');
});

test('DST fall-back boundary (2026-10-25): the day itself already uses the winter offset', () => {
    // 2026-10-25 08:00 Budapest (már CET, UTC+1) = 2026-10-25T07:00:00Z
    assert.equal(shouldRunReminderJob(new Date('2026-10-25T07:00:00Z')), true);
    assert.equal(getTomorrowPickupDateIso(new Date('2026-10-25T07:00:00Z')), '2026-10-26');
});
