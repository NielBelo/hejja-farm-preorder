const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A restore_order migráció strukturális ellenőrzése: a törzs az ÉLES definícióval
// (rollback fájl) egyezik, kivéve az időablak-ellenőrző blokk törlését.
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261012010000_restore_order_admin_window_exception.sql'), 'utf8').replace(/\r\n/g, '\n');
const rollback = fs.readFileSync(path.join(root, 'supabase/rollback/20261012_before_restore_order_admin_window_exception.sql'), 'utf8').replace(/\r\n/g, '\n');

function functionBody(text) {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.restore_order(p_order_id bigint)');
    assert.ok(start >= 0, 'missing restore_order');
    const endMarker = '\n$function$';
    const end = text.indexOf(endMarker, start);
    assert.ok(end >= 0, 'missing end of restore_order');
    return text.slice(start, end + endMarker.length);
}

const WINDOW_BLOCK = `    IF clock_timestamp() < v_time_window_start
       OR clock_timestamp() > v_time_window_end THEN
        RAISE EXCEPTION
            'A rendelési időszakon kívül a rendelés nem állítható vissza.';
    END IF;

`;

test('the migration body equals the production definition minus only the window check block', () => {
    const before = functionBody(rollback);
    const after = functionBody(migration);
    assert.equal(before.split(WINDOW_BLOCK).length - 1, 1);
    assert.equal(after.includes('A rendelési időszakon kívül'), false);
    assert.equal(before.replace(WINDOW_BLOCK, ''), after);
});

test('admin check, past pickup guard, stock handling and status update are kept', () => {
    const after = functionBody(migration);
    for (const fragment of [
        "AND role = 'admin'",
        'adminisztrátori jogosultság szükséges',
        'Elmúlt átvételi dátumú rendelés nem állítható vissza.',
        'Nincs elegendő szabad készlet a rendelés visszaállításához.',
        'SET available_stock = available_stock - v_quantity',
        "SET status = 'submitted'",
        'A rendelési időszak nincs megfelelően beállítva.',
    ]) {
        assert.ok(after.includes(fragment), `missing: ${fragment}`);
    }
});

test('only restore_order is replaced, grants and settings are not touched', () => {
    for (const text of [migration, rollback]) {
        assert.equal((text.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
        assert.doesNotMatch(text.replace(/^--.*$/gm, ''), /\bGRANT\b|\bREVOKE\b|DROP\s+FUNCTION|\bALTER\b/i);
        assert.match(text, /SECURITY DEFINER\s+SET search_path TO ''\s+AS \$function\$/);
    }
});
