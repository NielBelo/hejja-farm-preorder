# Éles Supabase séma tükör

Az éles adatbázis (public séma) **aktuális** állapota, forrása: `final/` biztonsági mentés (2026-11-21).
Ez a mappa az igazság forrása arra, hogy mi fut élesben - nem a `sql/` mappa, és nem a régi migrációk.

- `functions/<név>.sql` - egy függvény = egy fájl: teljes definíció + `REVOKE/GRANT EXECUTE`
- `tables.sql` - táblák, constraintek, indexek
- `triggers.sql`, `policies.sql` (RLS + policy-k), `table_grants.sql`

## Karbantartási szabály (kötelező)

Minden `supabase/migrations/*.sql`, ami függvényt, triggert, táblát, constraintet, indexet,
policy-t vagy jogosultságot módosít, **ugyanabban a változtatásban** frissíti ezt a tükröt is
(az érintett fájl teljes, új tartalmára cserélve). Új függvény = új fájl, törölt függvény = fájl törlése.
Ha az éles adatbázison kézzel futott módosítás van (SQL Editor), azt is ide kell vezetni.
Függvény módosítása előtt innen olvasunk, nem kérünk a felhasználótól snapshotot.
Drift gyanúja esetén: friss `final/`-féle mentés alapján újragenerálás.
