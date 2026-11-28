// Supabase ingyenes csomag: a 7 napig elégtelen aktivitású projektet a
// Supabase szüneteltetni kezdi. Az emlékeztető/szezonindító cron kikapcsolt
// küldésnél a Supabase-kliens létrehozása előtt kilép, ezért holtidényben
// semmilyen DB-kérés nem megy ki. Ez a napi, olvasás-only "ébren tartó"
// lekérdezés ezt pótolja - a küldési kapcsolóktól függetlenül fut.
// Az "products" tábla RLS-e publikus olvasást enged (lásd
// supabase/schema/policies.sql), ezért az anon kulcs is elég hozzá.

type FetchLike = (
    url: string,
    init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number }>;

export type KeepAliveResult = { ok: true } | { ok: false; reason: string };

export async function pingSupabase(
    supabaseUrl: string | undefined,
    apiKey: string | undefined,
    fetchImpl: FetchLike = fetch,
): Promise<KeepAliveResult> {
    if (!supabaseUrl || !apiKey) {
        return { ok: false, reason: "hiányzó Supabase URL vagy kulcs" };
    }

    try {
        const response = await fetchImpl(`${supabaseUrl}/rest/v1/products?select=id&limit=1`, {
            headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
        });
        return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

// Valódi DB-írás: az egysoros public.keepalive tábla last_ping oszlopát
// frissíti (upsert). A tábla csak service_role-lal írható (lásd
// supabase/migrations/20261128020000_keepalive.sql).
export async function touchKeepAlive(
    supabaseUrl: string | undefined,
    serviceRoleKey: string | undefined,
    now: Date = new Date(),
    fetchImpl: FetchLike = fetch,
): Promise<KeepAliveResult> {
    if (!supabaseUrl || !serviceRoleKey) {
        return { ok: false, reason: "hiányzó Supabase URL vagy service role kulcs" };
    }

    try {
        const response = await fetchImpl(`${supabaseUrl}/rest/v1/keepalive?on_conflict=id`, {
            method: "POST",
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
                Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify({ id: 1, last_ping: now.toISOString() }),
        });
        return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

// A 3 évnél régebbi törölt-felhasználó napló sorok törlése (lásd
// supabase/migrations/20261129000000_account_deletion_anonymization.sql).
// Naponta fut a keep-alive cronnal együtt; hibája nem érinti a többi jobot.
export async function purgeExpiredDeletedUsers(
    supabaseUrl: string | undefined,
    serviceRoleKey: string | undefined,
    fetchImpl: FetchLike = fetch,
): Promise<KeepAliveResult> {
    if (!supabaseUrl || !serviceRoleKey) {
        return { ok: false, reason: "hiányzó Supabase URL vagy service role kulcs" };
    }

    try {
        const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/purge_expired_deleted_users`, {
            method: "POST",
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                "Content-Type": "application/json",
            },
            body: "{}",
        });
        return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
}
