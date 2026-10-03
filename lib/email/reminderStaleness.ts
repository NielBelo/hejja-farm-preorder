import "server-only";

// Egy "sending" állapotú reminder-rekordot akkor tekintünk elavultnak
// (stale-nek), ha legalább ennyi ideje van "sending" állapotban. Ez jóval
// hosszabb, mint egy normál SMTP2GO-hívás + a körülötte lévő feldolgozás
// valós ideje (lásd lib/email/reminderRun.ts MAX_CONCURRENT_SENDS-szel
// korlátozott batch-küldést lib/email/sendReminderEmail.ts-ben), ezért egy
// ilyen sor szinte biztosan egy megszakadt (összeomlott/timeoutolt)
// workeré, NEM egy másik, épp aktívan dolgozó workeré.
export const STALE_SENDING_THRESHOLD_MS = 10 * 60 * 1000;

// Csak akkor stale, ha az attempted_at ismert és a küszöbidőnél régebbi.
// Hiányzó/értelmezhetetlen attempted_at esetén SZÁNDÉKOSAN "nem stale"-t ad
// vissza - hiányos adat alapján soha nem szabad "bizonytalan" jelzést
// generálni, mert az a hívó oldalán (lib/email/sendReminderEmail.ts) egy
// külön adatbetöltést (loadOrderNotificationData) indítana feleslegesen és
// pontatlan admin-összesítő bejegyzést eredményezne.
export function isStaleSending(attemptedAt: string | null, now: Date): boolean {
    if (!attemptedAt) {
        return false;
    }

    const attemptedAtMs = new Date(attemptedAt).getTime();

    if (Number.isNaN(attemptedAtMs)) {
        return false;
    }

    return now.getTime() - attemptedAtMs >= STALE_SENDING_THRESHOLD_MS;
}

// Ember által olvasható időtartam az admin futásösszesítőhöz (pl. "14
// perce") - csak perc pontosságú, nincs szükség ennél finomabb
// felbontásra egy manuális ellenőrzést kérő jelzésnél.
export function formatSendingDuration(attemptedAt: string | null, now: Date): string {
    if (!attemptedAt) {
        return "ismeretlen ideje";
    }

    const attemptedAtMs = new Date(attemptedAt).getTime();

    if (Number.isNaN(attemptedAtMs)) {
        return "ismeretlen ideje";
    }

    const minutes = Math.max(0, Math.round((now.getTime() - attemptedAtMs) / 60000));
    return minutes === 1 ? "1 perce" : `${minutes} perce`;
}
