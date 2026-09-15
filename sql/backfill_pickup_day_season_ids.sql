-- Futtasd a Supabase SQL Editorban, EGYSZER, a fix_multi_season_and_delete.sql után.
--
-- A korábban (a season_parameter_id bevezetése előtt) létrehozott átvételi
-- napoknál ez a mező NULL maradt, mert a régi admin_save_season_parameters
-- sosem töltötte ki. Emiatt szerkesztéskor "eltűntek" a meglévő átvételi
-- napok a formból, hiszen az oldal már season_parameter_id alapján keresi
-- őket. Ez a script egyszeri visszatöltést végez: minden olyan pickup_days
-- sorhoz, aminek season_parameter_id-je még üres, megkeresi a hozzá tartozó
-- szezont az (akkor még egyedi) év + szezon típus alapján, és beállítja a
-- kapcsolatot.
--
-- Biztonságos: csak azokat a sorokat érinti, ahol season_parameter_id még
-- NULL, és csak akkor állít be értéket, ha egyértelműen (pontosan egy)
-- megfelelő szezont talál hozzá.

update public.pickup_days p
set season_parameter_id = sp.id
from public.season_parameters sp
where p.season_parameter_id is null
  and p.year = sp.year
  and p.season = sp.season
  and (
    select count(*) from public.season_parameters sp2
    where sp2.year = p.year and sp2.season = p.season
  ) = 1;

-- Ellenőrzés: ez a lekérdezés mutatja, ha maradt olyan átvételi nap, amit
-- nem sikerült egyértelműen párosítani (pl. mert már akkor is duplikált
-- volt az év+szezon kombináció). Ha van találat, azokat kézzel kell
-- rendezni (season_parameter_id kézi beállítása a megfelelő sorra).
select * from public.pickup_days where season_parameter_id is null;
