import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type SeasonLaunchSendStatus = "pending" | "sending" | "sent" | "failed";

export type SeasonLaunchClaim = {
    id: number;
    claimed: boolean;
    status: SeasonLaunchSendStatus;
    attemptedAt: string | null;
};

// Atomikus lefoglalás (public.claim_season_launch_send, lásd
// supabase/migrations/20261128010000_season_launch_sends.sql): egy szezon +
// egy vásárló párra legfeljebb egyszer ad claimed=true-t. Egy már "sending"
// sort SOHA nem foglal le újra - a stale esetet a hívó kezeli.
export async function claimSeasonLaunchSend(
    supabase: SupabaseClient,
    seasonParameterId: number,
    userId: string,
    email: string,
): Promise<SeasonLaunchClaim> {
    const { data, error } = await supabase.rpc("claim_season_launch_send", {
        p_season_parameter_id: seasonParameterId,
        p_user_id: userId,
        p_email: email,
    });

    if (error) {
        throw new Error(`A szezonértesítő-rekord lefoglalása sikertelen (${userId}): ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
        throw new Error(`A szezonértesítő-rekord lefoglalása nem adott vissza eredményt (${userId}).`);
    }

    return {
        id: row.id,
        claimed: row.claimed,
        status: row.status,
        attemptedAt: row.attempted_at ?? null,
    };
}

export type SeasonLaunchFinalizeOutcome =
    | { status: "sent"; providerMessageId: string }
    | { status: "failed"; errorMessage: string };

export async function finalizeSeasonLaunchSend(
    supabase: SupabaseClient,
    id: number,
    outcome: SeasonLaunchFinalizeOutcome,
): Promise<void> {
    const { error } = await supabase.rpc("finalize_season_launch_send", {
        p_id: id,
        p_status: outcome.status,
        p_provider_message_id: outcome.status === "sent" ? outcome.providerMessageId : null,
        p_error_message: outcome.status === "failed" ? outcome.errorMessage.slice(0, 500) : null,
    });

    if (error) {
        throw new Error(`A szezonértesítő-rekord lezárása sikertelen (#${id}): ${error.message}`);
    }
}
