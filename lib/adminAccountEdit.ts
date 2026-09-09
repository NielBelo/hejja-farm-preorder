export type AccountProfileInput = {
    first_name: string;
    last_name: string;
    phone: string;
    county: string;
    city: string;
};

export function validateAccountProfile(input: unknown): { profile: AccountProfileInput; error?: never } | { error: string; profile?: never } {
    if (!input || typeof input !== "object") return { error: "Érvénytelen személyes adatok." };
    const values = input as Record<string, unknown>;
    const profile = {} as AccountProfileInput;
    for (const key of ["first_name", "last_name", "phone", "county", "city"] as const) {
        if (typeof values[key] !== "string") return { error: "Érvénytelen személyes adatok." };
        profile[key] = values[key].trim();
        if (profile[key].length > 100) return { error: "Egy mező legfeljebb 100 karakter lehet." };
    }
    if (!profile.first_name || !profile.last_name || !profile.county) {
        return { error: "A vezetéknév, keresztnév és vármegye megadása kötelező." };
    }
    let digits = profile.phone.replace(/[\s()+-]/g, "");
    if (digits.startsWith("06")) digits = `36${digits.slice(2)}`;
    if (!/^36\d{9}$/.test(digits)) return { error: "Adjon meg érvényes magyar telefonszámot (pl. +36 30 123 4567)." };
    profile.phone = `+${digits}`;
    return { profile };
}
