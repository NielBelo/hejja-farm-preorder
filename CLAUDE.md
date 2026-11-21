@AGENTS.md

## Supabase séma tükör

- Az éles tárolt eljárások/triggerek/táblák tükre: `supabase/schema/` (lásd README.md). Függvény módosítása előtt onnan olvass, ne kérj snapshotot a felhasználótól.
- Minden migráció, ami DB-objektumot (függvény, trigger, tábla, constraint, index, policy, grant) módosít, ugyanabban a változtatásban frissíti a `supabase/schema/` tükröt is. Ez kötelező, a felhasználó külön hangsúlyozta.
