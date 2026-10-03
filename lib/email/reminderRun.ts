import "server-only";

export type ReminderRunStats = {
    eligibleCount: number;
    attemptedCount: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
    /**
     * Stale "sending" állapotban talált (feltehetően egy megszakadt worker
     * által félbehagyott) reminderek száma ebben a futásban - lásd
     * lib/email/reminderStaleness.ts. NEM része attemptedCount-nak (ez a
     * worker NEM próbálta meg elküldeni, szándékosan nem indított automata
     * retry-t), és önmagában NEM is triggerel admin futásösszesítőt (lásd
     * shouldSendAdminReminderSummary lent) - de ha az összesítő attemptedCount
     * alapján úgyis elkészül, ezek a rekordok is szerepelnek benne.
     */
    uncertainCount: number;
};

export type ReminderRunFailure = {
    orderId: number;
    orderNumber: string;
    recipient: string;
    errorMessage: string;
};

export type ReminderRunUncertain = {
    orderId: number;
    orderNumber: string;
    recipient: string;
    /** Emberi nyelvű magyarázat (pl. "14 perce 'sending' állapotban..."). */
    detail: string;
};

export type ReminderOutcome =
    | { kind: "skipped" }
    | { kind: "sent" }
    | ({ kind: "failed" } & ReminderRunFailure)
    | ({ kind: "uncertain" } & ReminderRunUncertain);

// attempt = tényleges kiküldési kísérlet történt egy rendelésre (akár
// sikeres, akár sikertelen a vége - mindkettő beleszámít). A skip (pl. a
// reminder már korábban "sent" volt, vagy épp egy másik worker frissen
// dolgozik rajta) SOSEM számít attemptnek - és a "uncertain" (stale
// "sending", lásd lib/email/reminderStaleness.ts) SEM: ilyenkor ez a
// worker SZÁNDÉKOSAN nem próbálkozott (nem tudjuk biztosan, elküldte-e már
// az SMTP2GO, és a vak retry dupla ügyfél-e-mailt okozhatna).
export function summarizeReminderOutcomes(
    outcomes: ReminderOutcome[],
    eligibleCount: number,
): ReminderRunStats {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let uncertainCount = 0;

    for (const outcome of outcomes) {
        if (outcome.kind === "sent") {
            sentCount += 1;
        } else if (outcome.kind === "failed") {
            failedCount += 1;
        } else if (outcome.kind === "uncertain") {
            uncertainCount += 1;
        } else {
            skippedCount += 1;
        }
    }

    return {
        eligibleCount,
        attemptedCount: sentCount + failedCount,
        sentCount,
        failedCount,
        skippedCount,
        uncertainCount,
    };
}

// Pontos szabály: attemptedCount = 0 esetén nincs admin futásösszesítő,
// attemptedCount >= 1 esetén pontosan egy - függetlenül attól, hogy a
// kísérletek sikeresek vagy sikertelenek voltak. Az uncertainCount ÖNMAGÁBAN
// NEM triggerelhet admin e-mailt (ha ebben a futásban egyetlen tényleges
// kiküldési kísérlet sem történt, még akkor sem, ha közben egy stale
// reminder is felmerült) - de ha a feltétel attemptedCount alapján úgyis
// teljesül, az összesítőben a stale/uncertain rekordok is szerepelnek
// (lásd lib/email/adminReminderSummary.ts buildAdminReminderSummary).
export function shouldSendAdminReminderSummary(stats: ReminderRunStats): boolean {
    return stats.attemptedCount >= 1;
}

// Legfeljebb `limit` párhuzamos feldolgozás - NEM queue-rendszer, csak
// néhány "sáv" (lane), amelyek egy megosztott indexből húznak elemeket,
// amíg el nem fogynak. Így pl. 50 reminder esetén sosem fut 50 párhuzamos
// HTTP-hívás egyszerre, csak legfeljebb `limit`.
export async function processWithConcurrencyLimit<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function runLane() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    }

    const laneCount = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: laneCount }, () => runLane()));

    return results;
}
