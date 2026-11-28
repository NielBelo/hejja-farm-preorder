// Vékony wrapper az OpenNext által generált Cloudflare Worker köré
// (.open-next/worker.js, build-generált, lásd .gitignore - ezért NEM
// másoljuk át a tartalmát, csak importáljuk és továbbadjuk). A `fetch`
// handler és a Durable Object exportok változatlanul az OpenNext workeré
// maradnak; ez a fájl KIZÁRÓLAG a napi emlékeztető cron-feladathoz
// szükséges `scheduled` handlert adja hozzá.
// A "../.open-next/worker.js" csak a build FOLYAMÁN, az opennextjs-cloudflare
// build "next build" lépése UTÁN generálódik - tiszta checkout-on (pl. CI)
// ez a fájl a "next build" saját típusellenőrzése IDEJÉN még nem létezik.
// A Next típusellenőrzése a teljes tsconfig.json "include"-ja alapján épít
// fel egy TS-programot (nem csak a route-okból elérhető fájlokból), ezért
// ezt a worker-entry fájlt is ellenőrzi, és hiányzó modul esetén TS2307-tel
// elbuktatná a teljes "next build"-et. Ez az OpenNext hivatalosan
// dokumentált mintája ennek kezelésére (lásd
// https://opennext.js.org/cloudflare/howtos/custom-worker): soronként
// célzott "@ts-ignore", NEM globális skipLibCheck/ignoreBuildErrors - a
// tényleges bundlingot (wrangler/esbuild) ez nem érinti, az a build végén,
// amikor a fájl már valóban létezik, helyesen oldja fel az importot.
//
// Szándékosan "@ts-ignore", NEM "@ts-expect-error": az utóbbi maga is
// hibát dobna ("Unused '@ts-expect-error' directive"), ha ezt a fájlt egy
// korábbi, lokálisan már lefutott build után (amikor a worker.js még a
// lemezen maradt) futtatjuk újra típusellenőrzésre - a "@ts-ignore"
// mindkét állapotban (fájl létezik/nem létezik) biztonságosan, hiba
// nélkül viselkedik.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore "../.open-next/worker.js" csak build időben generálódik
import openNextWorker from "../.open-next/worker.js";
// A re-export csak akkor szükséges, ha az app DO Queue-t/DO Tag Cache-t
// használ (lásd az OpenNext minta ugyanezen megjegyzését a fenti linken).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore "../.open-next/worker.js" csak build időben generálódik
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "../.open-next/worker.js";
import { createClient } from "@supabase/supabase-js";
import { isReminderSendingBlocked, sendPickupReminders } from "../lib/email/sendReminderEmail";
import { getTomorrowPickupDateIso, shouldRunReminderJob } from "./reminderSchedule";
import { createReminderChunkRunner, handleReminderChunkRequest, REMINDER_CHUNK_PATH } from "./reminderChunk";
import { isSeasonLaunchSendingBlocked, sendSeasonLaunchEmails } from "../lib/email/sendSeasonLaunch";
import {
    createSeasonLaunchChunkRunner,
    handleSeasonLaunchChunkRequest,
    SEASON_LAUNCH_CHUNK_PATH,
} from "./seasonLaunchChunk";
import { readSeasonLaunchSwitch, type SeasonLaunchSwitchKv } from "../lib/email/seasonLaunchSwitch";
import { applyReminderSwitchToEnv } from "../lib/email/reminderSwitch";
import { getCalendarDate } from "../lib/orderWindow";
import { pingSupabase, purgeExpiredDeletedUsers, touchKeepAlive } from "./keepAlive";

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

type WorkerEnvLike = {
    WORKER_SELF_REFERENCE?: { fetch(request: Request): Promise<Response> };
    MAINTENANCE_KV?: SeasonLaunchSwitchKv;
};

async function runReminderJob(pickupDateIso: string, env: WorkerEnvLike) {
    // A sending guardot (NODE_ENV === "production" ÉS
    // REMINDER_EMAIL_SENDING_ENABLED === "true", lásd
    // lib/email/reminderGuard.ts) itt, a Supabase kliens létrehozása ELŐTT
    // ellenőrizzük, nem csak sendPickupReminders belsejében. Így amíg a
    // küldés szándékosan ki van kapcsolva:
    //   - a SUPABASE_SERVICE_ROLE_KEY (Cloudflare Worker secret) hiánya
    //     irreleváns - sosem próbálunk meg Supabase klienst létrehozni vele;
    //   - nem történik felesleges DB-lekérdezés (sendPickupReminders
    //     egyébként a jogosult rendelések számát blokkolt állapotban is
    //     lekérdezné, diagnosztikai célból - ez a worker/cron útvonalon nem
    //     szükséges, mivel blokkolt állapotban admin összesítő sem megy ki);
    //   - nincs zavaró hibalog: egy hiányzó/érvénytelen service role kulcs
    //     esetén a @supabase/supabase-js createClient() szinkron hibát dob
    //     ("supabaseKey is required"), amit korábban csak a lenti try/catch
    //     kapott el és logolt hibaként - pedig ez valójában a guard által
    //     szándékosan megakadályozott, biztonságos állapot, nem hiba.
    // A kapcsoló állapotát (superadmin KV-kapcsoló, átmenetileg a régi env
    // beállítás tartalékkal) a guard ELŐTT oldjuk fel, lásd lib/email/reminderSwitch.ts.
    const reminderEnabled = await applyReminderSwitchToEnv(env.MAINTENANCE_KV);
    if (isReminderSendingBlocked()) {
        console.log(
            `[reminder] scheduled no-op: a küldés jelenleg ki van kapcsolva `
            + `(NODE_ENV=${process.env.NODE_ENV ?? "development"}, `
            + `kapcsoló=${reminderEnabled ? "be" : "ki"}) - `
            + `Supabase-kliens sem jön létre. Érintett átvételi nap: ${pickupDateIso}.`,
        );
        return;
    }

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

        const runChunk = env.WORKER_SELF_REFERENCE
            ? createReminderChunkRunner(env.WORKER_SELF_REFERENCE)
            : undefined;
        const result = await sendPickupReminders(supabase, pickupDateIso, runChunk);
        console.log(`[reminder] scheduled futás eredménye (${pickupDateIso}):`, result);
    } catch (error) {
        console.error(`[reminder] scheduled futás hiba (${pickupDateIso}):`, error);
    }
}

// Szezonindítási értesítő: a szezon kezdőnapján, a 08:00-s futáskor megy ki.
// A guard (NODE_ENV === "production" ÉS a superadmin KV-kapcsolója bekapcsolva,
// lásd lib/email/seasonLaunchGuard.ts és seasonLaunchSwitch.ts) a Supabase
// kliens létrehozása ELŐTT dönt: kikapcsolt állapotban semmi nem történik.
// Az emlékeztetőtől független futás: egyik hibája nem érinti a másikat.
async function runSeasonLaunchJob(todayIso: string, env: WorkerEnvLike) {
    const sendingEnabled = (await readSeasonLaunchSwitch(env.MAINTENANCE_KV)).enabled;
    if (isSeasonLaunchSendingBlocked(sendingEnabled)) {
        console.log(`[season-launch] scheduled no-op: a küldés ki van kapcsolva (${todayIso}).`);
        return;
    }

    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const runChunk = env.WORKER_SELF_REFERENCE
            ? createSeasonLaunchChunkRunner(env.WORKER_SELF_REFERENCE)
            : undefined;
        const result = await sendSeasonLaunchEmails(supabase, todayIso, runChunk, { sendingEnabled });
        console.log(`[season-launch] scheduled futás eredménye (${todayIso}):`, result);
    } catch (error) {
        console.error(`[season-launch] scheduled futás hiba (${todayIso}):`, error);
    }
}

async function runKeepAliveJob() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Olvasás: az anon kulcs elég (a products publikusan olvasható); ha a
    // Workerben nem elérhető, a service role secretre esünk vissza.
    const read = await pingSupabase(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? serviceRoleKey);
    // Írás: a közösségi tapasztalatok szerint a puszta olvasás nem mindig
    // elég a Supabase auto-pause ellen, ezért valódi írás is megy.
    const write = await touchKeepAlive(url, serviceRoleKey);
    // 3 évnél régebbi törölt-felhasználó napló sorok törlése (adatmegőrzési határ).
    const purge = await purgeExpiredDeletedUsers(url, serviceRoleKey);

    for (const [name, result] of [["olvasás", read], ["írás", write], ["törölt-felhasználó napló purge", purge]] as const) {
        if (result.ok) {
            console.log(`[keep-alive] ${name} ok`);
        } else {
            console.error(`[keep-alive] ${name} hiba: ${result.reason}`);
        }
    }
}

const worker = {
    async fetch(request: Request, env: WorkerEnvLike, ctx: unknown) {
        const { pathname } = new URL(request.url);
        if (pathname === REMINDER_CHUNK_PATH) {
            return handleReminderChunkRequest(request, env.MAINTENANCE_KV);
        }
        if (pathname === SEASON_LAUNCH_CHUNK_PATH) {
            return handleSeasonLaunchChunkRequest(request, env.MAINTENANCE_KV);
        }
        return openNextWorker.fetch(request, env, ctx);
    },

    // A Cloudflare cron csak UTC-ben ütemezhető, ezért két UTC időpontban
    // fut (lásd wrangler.jsonc "triggers.crons": "0 6 * * *" és
    // "0 7 * * *") - nyáron a 06:00 UTC, télen a 07:00 UTC futás esik
    // egybe a Budapest szerinti 08:00-val. A tényleges döntést (és a
    // holnapi pickup date kiszámítását) a reminderSchedule.ts végzi,
    // Europe/Budapest naptári nap/óra szerint, fix UTC eltolás nélkül.
    async scheduled(
        event: ScheduledControllerLike,
        env: WorkerEnvLike,
        ctx: ExecutionContextLike,
    ) {
        const now = new Date(event.scheduledTime);

        // Supabase ingyenes csomag auto-pause ellen: a küldési kapcsolóktól és
        // az órai szűrőtől függetlenül, minden cron-futáskor (naponta kétszer)
        // egy olcsó olvasás. Hibája nem érinti az alatta lévő jobokat.
        ctx.waitUntil(runKeepAliveJob());

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

        // A tényleges sending guardot (NODE_ENV === "production" ÉS
        // REMINDER_EMAIL_SENDING_ENABLED === "true") a runReminderJob eleje
        // ellenőrzi, MÉG a Supabase kliens létrehozása előtt - ezt itt nem
        // kerüljük meg, localhoston/teszt közben, vagy ha a flag nincs
        // bekapcsolva, a küldés emiatt mindig blokkolva marad, és Supabase
        // kliens sem jön létre.
        ctx.waitUntil(runReminderJob(pickupDateIso, env));

        const todayIso = getCalendarDate(now.toISOString());
        if (todayIso) {
            ctx.waitUntil(runSeasonLaunchJob(todayIso, env));
        }
    },
};

export default worker;
