import "server-only";

// Kemény védelem a reminder-küldési utak (vásárlói emlékeztető ÉS admin
// futásösszesítő, lásd lib/email/sendReminderEmail.ts és
// lib/email/adminReminderSummary.ts) elé: mindkettő csak akkor hívhatja meg
// ténylegesen az SMTP2GO API-t, ha EGYSZERRE teljesül, hogy production
// környezetben fut (NODE_ENV === "production") ÉS egy explicit environment
// flag (REMINDER_EMAIL_SENDING_ENABLED === "true") be van kapcsolva. Ez két
// külön kapcsoló, hogy se a "next dev" (fejlesztői NODE_ENV), se egy
// production build puszta localhoston/Cloudflare Workeren való futtatása (a
// flag beállítása nélkül) ne engedhessen ki véletlenül valódi e-mailt - a
// flaget csak a tényleges, szándékos élesítéskor kell majd bekapcsolni. Ez
// KIZÁRÓLAG a reminder küldési utakat védi - a lib/email/smtp2go.ts-t
// használó egyéb funkciók (pl. regisztrációs meghívó) működése változatlan
// marad.
//
// Önálló fájlban él (nem lib/email/sendReminderEmail.ts-ben), mert az admin
// futásösszesítő (lib/email/adminReminderSummary.ts) is importálja - ha a
// guard a sendReminderEmail.ts-ben maradna, ez körkörös importot okozna
// (sendReminderEmail.ts már importálja az adminReminderSummary.ts-t a
// futásösszesítő kiküldéséhez).
export function isReminderSendingBlocked() {
    return process.env.NODE_ENV !== "production"
        || process.env.REMINDER_EMAIL_SENDING_ENABLED !== "true";
}
