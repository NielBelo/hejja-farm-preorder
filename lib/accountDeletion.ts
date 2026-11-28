// A saját fiók törlésének megerősítő szava (kis- és nagybetűre nem érzékeny,
// a szóközöket levágjuk, hogy a magyar ékezetes beírás ne okozzon félreértést).
export const ACCOUNT_DELETION_CONFIRMATION = "TÖRLÉS";

export function isAccountDeletionConfirmed(input: unknown): boolean {
    return typeof input === "string"
        && input.trim().toLocaleUpperCase("hu-HU") === ACCOUNT_DELETION_CONFIRMATION;
}
