-- Régi rendelési méretmegnevezések egyszeri egységesítése.
-- Futtatható a Supabase SQL Editorban; csak az order_items.size_preference
-- három korábbi értékét módosítja, minden rendelési verzióban.

begin;

update public.order_items
set size_preference = case size_preference
    when 'Átlagos méret megfelelő' then 'Átlagos méret'
    when 'Átlagostól inkább kisebbet kérek, ha lehet' then 'Átlagostól kisebb méret'
    when 'Átlagostól inkább nagyobbat kérek, ha lehet' then 'Átlagostól nagyobb méret'
end
where size_preference in (
    'Átlagos méret megfelelő',
    'Átlagostól inkább kisebbet kérek, ha lehet',
    'Átlagostól inkább nagyobbat kérek, ha lehet'
);

commit;
