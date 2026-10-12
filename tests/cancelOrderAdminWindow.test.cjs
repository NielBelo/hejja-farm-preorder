const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A cancel_order migráció strukturális ellenőrzése: a törzs az ÉLES definícióval
// (rollback fájl) egyezik, kivéve az admin-kivételt az időablak-ellenőrzésnél.
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261012000000_cancel_order_admin_window_exception.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'supabase/rollback/20261012_before_cancel_order_admin_window_exception.sql'), 'utf8');

function functionBody(text) {
    const start = text.indexOf('CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id bigint)');
    assert.ok(start >= 0, 'missing cancel_order');
    const endMarker = '\n$function$';
    const end = text.indexOf(endMarker, start);
    assert.ok(end >= 0, 'missing end of cancel_order');
    return text.slice(start, end + endMarker.length);
}

const ORIGINAL = `    IF now() < v_time_window_start THEN
        RAISE EXCEPTION
            'A rendelési időszak még nem kezdődött el.';
    END IF;

    IF now() > v_time_window_end THEN
        RAISE EXCEPTION
            'A rendelési időszak már lezárult, a rendelés nem mondható le.';
    END IF;
`;
const CHANGED = `    -- Az előrendelési időablak csak a normál vásárlóra vonatkozik; az admin
    -- az ablakon kívül is lemondhat (az update_order is így működik).
    IF NOT v_is_admin THEN
        IF now() < v_time_window_start THEN
            RAISE EXCEPTION
                'A rendelési időszak még nem kezdődött el.';
        END IF;

        IF now() > v_time_window_end THEN
            RAISE EXCEPTION
                'A rendelési időszak már lezárult, a rendelés nem mondható le.';
        END IF;
    END IF;
`;

test('the migration body equals the production definition plus only the admin window exception', () => {
    const after = functionBody(migration);
    assert.equal(after.split(CHANGED).length - 1, 1);
    assert.equal(after.replace(CHANGED, ORIGINAL), functionBody(rollback));
});

test('the migration touches only cancel_order, keeps grants and does no data changes outside the function', () => {
    assert.doesNotMatch(migration, /FUNCTION\s+public\.update_order/);
    assert.doesNotMatch(migration, /\bGRANT\b|\bREVOKE\b|DROP\s+FUNCTION/i);
    assert.equal((migration.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
    assert.equal((rollback.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1);
    // A függvény attribútumai az éles definícióval egyeznek.
    for (const text of [migration, rollback]) {
        assert.match(text, /SECURITY DEFINER\s+SET search_path TO ''\s+AS \$function\$/);
    }
});
