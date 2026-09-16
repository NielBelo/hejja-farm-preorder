export const SIZE_PREFERENCES = [
    "Átlagos méret",
    "Átlagostól kisebb méret",
    "Átlagostól nagyobb méret",
] as const;

export const DEFAULT_SIZE_PREFERENCE = SIZE_PREFERENCES[0];

const legacySizePreferences: Record<string, typeof DEFAULT_SIZE_PREFERENCE | typeof SIZE_PREFERENCES[1] | typeof SIZE_PREFERENCES[2]> = {
    "Átlagos méret megfelelő": "Átlagos méret",
    "Átlagostól inkább kisebbet kérek, ha lehet": "Átlagostól kisebb méret",
    "Átlagostól inkább nagyobbat kérek, ha lehet": "Átlagostól nagyobb méret",
};

export function normalizeSizePreference(value: string | null | undefined) {
    if (SIZE_PREFERENCES.includes(value as typeof SIZE_PREFERENCES[number])) return value as typeof SIZE_PREFERENCES[number];
    return legacySizePreferences[value ?? ""] ?? DEFAULT_SIZE_PREFERENCE;
}
