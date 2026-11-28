import { createClient } from "@supabase/supabase-js";
import {
    isSeasonLaunchSendingBlocked,
    processSeasonLaunchChunk,
    type SeasonLaunchChunkRunner,
    type SeasonLaunchOutcome,
    type SeasonLaunchRecipient,
    type SeasonLaunchSeason,
} from "../lib/email/sendSeasonLaunch";
import { readSeasonLaunchSwitch, type SeasonLaunchSwitchKv } from "../lib/email/seasonLaunchSwitch";

// Belső végpont a szezonindítási értesítő csomagjaihoz (ugyanaz a minta, mint
// worker/reminderChunk.ts): minden csomag külön worker-futásban, saját 50
// subrequest-kerettel fut. Csak a service role kulccsal (Bearer) hívható.
export const SEASON_LAUNCH_CHUNK_PATH = "/__internal/season-launch-chunk";

type ServiceBindingLike = {
    fetch(request: Request): Promise<Response>;
};

export async function handleSeasonLaunchChunkRequest(
    request: Request,
    kv: SeasonLaunchSwitchKv | null | undefined,
): Promise<Response> {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || request.headers.get("authorization") !== `Bearer ${serviceKey}`) {
        return new Response("Forbidden", { status: 403 });
    }

    // A kapcsolót csomagonként újra beolvassuk: ha a superadmin közben
    // kikapcsolja, a hátralévő csomagok már nem mennek ki.
    const sendingEnabled = (await readSeasonLaunchSwitch(kv)).enabled;
    if (isSeasonLaunchSendingBlocked(sendingEnabled)) {
        return new Response("Sending blocked", { status: 409 });
    }

    const body = (await request.json()) as {
        season: SeasonLaunchSeason;
        recipients: SeasonLaunchRecipient[];
        runAt: string;
    };
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const outcomes = await processSeasonLaunchChunk(supabase, body.season, body.recipients, new Date(body.runAt), { sendingEnabled });
    return Response.json({ outcomes });
}

export function createSeasonLaunchChunkRunner(binding: ServiceBindingLike): SeasonLaunchChunkRunner {
    return async (season, recipients, runAt) => {
        const response = await binding.fetch(new Request(`https://internal${SEASON_LAUNCH_CHUNK_PATH}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            },
            body: JSON.stringify({ season, recipients, runAt: runAt.toISOString() }),
        }));

        if (!response.ok) {
            throw new Error(`A csomag-feldolgozó HTTP ${response.status} választ adott.`);
        }

        const json = (await response.json()) as { outcomes: SeasonLaunchOutcome[] };
        return json.outcomes;
    };
}
