// Vékony wrapper az OpenNext által generált Cloudflare Worker köré
// (.open-next/worker.js, build-generált, lásd .gitignore - ezért NEM
// másoljuk át a tartalmát, csak importáljuk és továbbadjuk). A `fetch`
// handler és a Durable Object exportok változatlanul az OpenNext workeré
// maradnak; ez a fájl KIZÁRÓLAG a napi emlékeztető cron-feladathoz
// szükséges `scheduled` handlert adja hozzá.
import openNextWorker, {
    BucketCachePurge,
    DOQueueHandler,
    DOShardedTagCache,
} from "../.open-next/worker.js";
import { createClient } from "@supabase/supabase-js";
import { sendPickupReminders } from "../lib/email/sendReminderEmail";
import { getTomorrowPickupDateIso, shouldRunReminderJob } from "./reminderSchedule";

export { BucketCachePurge, DOQueueHandler, DOShardedTagCache };

// A @cloudflare/workers-types csomag nincs telepítve a projektben, ezért a
// scheduled handler paramétereit minimális, a ténylegesen használt alakra
// szűkített helyi típusokkal írjuk le a globális Cloudflare Workers
// típusok helyett.
type ScheduledControllerLike = {
    scheduledTime: number;
    cron: string;
};

type ExecutionContextLike = {
    waitUntil(promise: Promise<unknown>): void;
};

async function runReminderJob(pickupDateIso: string) {
    try {
        // A claim_reminder_send/finalize_reminder_send RPC-k (lásd
        // supabase/migrations/20260930000000_reminder_sends.sql) kizárólag
        // "service_role" szerepkörnek adnak EXECUTE jogot - SZÁNDÉKOSAN nem
        // "anon"-nak vagy "authenticated"-nek, mert ez a worker nem egy
        // bejelentkezett felhasználó nevében hív semmit. Az anon kulcs ezért
        // itt NEM használható, a hívás jogosultság hiányában elhasalna. A
        // SUPABASE_SERVICE_ROLE_KEY-t Cloudflare Worker secretként kell
        // beállítani ("wrangler secret put SUPABASE_SERVICE_ROLE_KEY") -
        // SOHA nem kerülhet a wrangler.jsonc "vars" mezőjébe, a .env.local-ba
        // vagy bármilyen NEXT_PUBLIC_ prefixű (így kliensoldalra bundle-ölt)
        // változóba.
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const result = await sendPickupReminders(supabase, pickupDateIso);
        console.log(`[reminder] scheduled futás eredménye (${pickupDateIso}):`, result);
    } catch (error) {
        console.error(`[reminder] scheduled futás hiba (${pickupDateIso}):`, error);
    }
}

const worker = {
    fetch: openNextWorker.fetch,

    // A Cloudflare cron csak UTC-ben ütemezhető, ezért két UTC időpontban
    // fut (lásd wrangler.jsonc "triggers.crons": "0 6 * * *" és
    // "0 7 * * *") - nyáron a 06:00 UTC, télen a 07:00 UTC futás esik
    // egybe a Budapest szerinti 08:00-val. A tényleges döntést (és a
    // holnapi pickup date kiszámítását) a reminderSchedule.ts végzi,
    // Europe/Budapest naptári nap/óra szerint, fix UTC eltolás nélkül.
    async scheduled(
        event: ScheduledControllerLike,
        _env: unknown,
        ctx: ExecutionContextLike,
    ) {
        const now = new Date(event.scheduledTime);

        if (!shouldRunReminderJob(now)) {
            console.log(
                `[reminder] scheduled kilépés: Budapest szerint nem 08 óra van (UTC=${now.toISOString()}).`,
            );
            return;
        }

        const pickupDateIso = getTomorrowPickupDateIso(now);
        console.log(
            `[reminder] scheduled indul: Budapest 08:00, holnapi átvételi nap = ${pickupDateIso}.`,
        );

        // sendPickupReminders (lib/email/sendReminderEmail.ts) a tényleges
        // SMTP2GO-küldés előtt mindig ellenőrzi a meglévő guardot
        // (NODE_ENV === "production" ÉS REMINDER_EMAIL_SENDING_ENABLED ===
        // "true") - ezt itt nem kerüljük meg, localhoston/teszt közben a
        // küldés emiatt mindig blokkolva marad.
        ctx.waitUntil(runReminderJob(pickupDateIso));
    },
};

export default worker;
