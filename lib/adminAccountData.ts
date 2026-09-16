export type AdminAccount = {
    id: string;
    user_id: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    county: string | null;
    city: string | null;
    special_size_preference: "smaller" | "larger" | null;
    oroshazi_delivery: boolean;
    role: string;
    is_superadmin: boolean;
    status: "invited" | "unconfirmed" | "registered";
    registered_at: string | null;
    updated_at: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    invited_at: string | null;
    confirmation_sent_at: string | null;
    invites: { id: string; email: string; created_at: string; sent_at: string | null; used_at: string | null }[];
    consents: { id: string; document_type: string; document_version: string; accepted_at: string }[];
};

export const accountStatusLabels = {
    invited: "Meghívó elküldve",
    unconfirmed: "Megerősítésre vár",
    registered: "Regisztrált",
};

export function accountName(account: AdminAccount) {
    return [account.last_name, account.first_name].filter(Boolean).join(" ") || account.email || "Név nélküli fiók";
}

export function filterAccounts(accounts: AdminAccount[], search: string, statuses: string[], roles: string[], counties: string[]) {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu");
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
    return accounts.filter((account) => {
        const text = normalize([accountName(account), account.email, account.phone, account.county, account.city, account.user_id].filter(Boolean).join(" "));
        return terms.every((term) => text.includes(term))
            && (!statuses.length || statuses.includes(account.status))
            && (!roles.length || roles.includes(account.role))
            && (!counties.length || counties.includes(account.county || "__missing"));
    });
}
