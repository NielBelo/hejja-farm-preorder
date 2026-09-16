export function formatHungarianPhoneInput(value: string): string {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("06")) digits = `36${digits.slice(2)}`;
    if (!digits.startsWith("36")) digits = `36${digits}`;
    digits = digits.slice(0, 11);

    const prefix = digits.slice(2, 4);
    const first = digits.slice(4, 7);
    const second = digits.slice(7, 11);

    return ["+36", prefix, first, second].filter(Boolean).join(" ");
}

export function normalizeHungarianPhone(value: string): string | null {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("06")) digits = `36${digits.slice(2)}`;
    return /^36\d{9}$/.test(digits) ? `+${digits}` : null;
}
