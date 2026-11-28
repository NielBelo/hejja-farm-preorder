import { normalizeHungarianPhone } from "@/lib/phoneNumber";

export type AccountProfileInput = {
    first_name: string;
    last_name: string;
    phone: string;
    county: string;
    city: string;
};

export type AdminAccountUpdateInput = AccountProfileInput & {
    role: "user" | "admin";
};

export function validateAdminAccount(input: unknown): { account: AdminAccountUpdateInput; error?: never } | { error: string; account?: never } {
    if (!input || typeof input !== "object") return { error: "Érvénytelen személyes adatok." };
    const values = input as Record<string, unknown>;
    const profile = {} as AccountProfileInput;
    for (const key of ["first_name", "last_name", "phone", "county", "city"] as const) {
        if (typeof values[key] !== "string") return { error: "Érvénytelen személyes adatok." };
        profile[key] = values[key].trim();
        if (profile[key].length > 100) return { error: "Egy mező legfeljebb 100 karakter lehet." };
    }
    if (!profile.first_name || !profile.last_name || !profile.county || !profile.city) {
        return { error: "A vezetéknév, keresztnév, megye és település megadása kötelező." };
    }
    const normalizedPhone = normalizeHungarianPhone(profile.phone);
    if (!normalizedPhone) return { error: "Adjon meg érvényes magyar telefonszámot (pl. +36 30 123 4567)." };
    profile.phone = normalizedPhone;

    if (values.role !== "user" && values.role !== "admin") {
        return { error: "Érvénytelen jogosultsági beállítás." };
    }

    return {
        account: {
            ...profile,
            role: values.role,
        },
    };
}
