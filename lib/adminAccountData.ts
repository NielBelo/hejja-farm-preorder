export type AdminAccount = {
    id: string;
    user_id: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    county: string | null;
    city: string | null;
    role: string;
    is_superadmin: boolean;
    status: "invited" | "unconfirmed" | "registered" | "deleted";
    registered_at: string | null;
    updated_at: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    invited_at: string | null;
    confirmation_sent_at: string | null;
    invites: { id: string; email: string; created_at: string; sent_at: string | null; used_at: string | null }[];
    consents: { id: string; document_type: string; document_version: string; accepted_at: string }[];
    // Csak a törölt ("deleted") státuszú bejegyzéseknél van értéke (lásd
    // deletedUserToAccount): a törlés ideje és forrása.
    deleted_at?: string | null;
    deletion_source?: string | null;
};

export const accountStatusLabels = {
    invited: "Meghívó elküldve",
    unconfirmed: "Megerősítésre vár",
    registered: "Regisztrált",
    deleted: "Törölt",
};

export type DeletedUserRow = {
    id: string;
    full_name: string;
    deleted_at: string;
    deletion_source: string;
};

// A törölt felhasználók naplósora (public.deleted_users) a fióklistában is
// megjelenik, "Törölt" állapottal. Csak a naplózott adat (név, idő, forrás)
// ismert, minden más mező üres.
export function deletedUserToAccount(row: DeletedUserRow): AdminAccount {
    return {
        id: `deleted:${row.id}`,
        user_id: null,
        email: null,
        first_name: null,
        last_name: row.full_name,
        phone: null,
        county: null,
        city: null,
        role: "user",
        is_superadmin: false,
        status: "deleted",
        registered_at: null,
        updated_at: null,
        email_confirmed_at: null,
        last_sign_in_at: null,
        invited_at: null,
        confirmation_sent_at: null,
        invites: [],
        consents: [],
        deleted_at: row.deleted_at,
        deletion_source: row.deletion_source,
    };
}

export function accountName(account: AdminAccount) {
    return [account.last_name, account.first_name].filter(Boolean).join(" ") || account.email || "Név nélküli fiók";
}

export function filterAccounts(accounts: AdminAccount[], search: string, statuses: string[], roles: string[], counties: string[]) {
    const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("hu");
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
    return accounts.filter((account) => {
        // A törölt felhasználónak nincs szerepköre és megyéje, ezért ezekre
        // szűrve nem jelenik meg.
        if (account.status === "deleted" && (roles.length || counties.length)) return false;
        const text = normalize([accountName(account), account.email, account.phone, account.county, account.city, account.user_id].filter(Boolean).join(" "));
        return terms.every((term) => text.includes(term))
            && (!statuses.length || statuses.includes(account.status))
            && (!roles.length || roles.includes(account.role))
            && (!counties.length || counties.includes(account.county || "__missing"));
    });
}
