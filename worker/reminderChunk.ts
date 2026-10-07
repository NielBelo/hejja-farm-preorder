import { createClient } from "@supabase/supabase-js";
import {
    isReminderSendingBlocked,
    processReminderChunk,
    type ReminderChunkRunner,
} from "../lib/email/sendReminderEmail";
import type { ReminderOrderTarget } from "../lib/email/reminderData";
import type { ReminderOutcome } from "../lib/email/reminderRun";

// Belső végpont a napi emlékeztető-csomagok futtatásához. A Worker a saját
// szolgáltatás-bindingjén (WORKER_SELF_REFERENCE) keresztül hívja meg, így
// minden csomag külön worker-futásban, saját 50 subrequest-kerettel fut.
// A publikus route-on is elérhető, ezért a kérés csak a service role kulccsal
// (Bearer) fogadható el.
export const REMINDER_CHUNK_PATH = "/__internal/reminder-chunk";

type ServiceBindingLike = {
    fetch(request: Request): Promise<Response>;
};

export async function handleReminderChunkRequest(request: Request): Promise<Response> {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey || request.headers.get("authorization") !== `Bearer ${serviceKey}`) {
        return new Response("Forbidden", { status: 403 });
    }

    if (isReminderSendingBlocked()) {
        return new Response("Sending blocked", { status: 409 });
    }

    const body = (await request.json()) as { targets: ReminderOrderTarget[]; runAt: string };
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceKey,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const outcomes = await processReminderChunk(supabase, body.targets, new Date(body.runAt));
    return Response.json({ outcomes });
}

export function createReminderChunkRunner(binding: ServiceBindingLike): ReminderChunkRunner {
    return async (targets, runAt) => {
        const response = await binding.fetch(new Request(`https://internal${REMINDER_CHUNK_PATH}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
            },
            body: JSON.stringify({ targets, runAt: runAt.toISOString() }),
        }));

        if (!response.ok) {
            throw new Error(`A csomag-feldolgozó HTTP ${response.status} választ adott.`);
        }

        const json = (await response.json()) as { outcomes: ReminderOutcome[] };
        return json.outcomes;
    };
}
