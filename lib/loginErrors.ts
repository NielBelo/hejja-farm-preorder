export const LOGIN_GENERIC_ERROR = "Hibás e-mail cím vagy jelszó.";
export const LOGIN_UNKNOWN_EMAIL_ERROR =
    "Ehhez az e-mail-címhez nem tartozik fiók. Ellenőrizd a címet, vagy kérj meghívót.";

// Sikertelen bejelentkezés után döntjük el, melyik hibát mutassuk. A
// "nem létező fiók" figyelmeztetés csak akkor jelenik meg, ha az adatbázis
// biztosan azt válaszolta, hogy az e-mail-cím nem szerepel (false); ha az
// ellenőrzés nem sikerült (null) vagy a cím létezik (true), az általános
// hibaüzenet marad, így az ellenőrzés hibája sosem rontja el a belépést.
export function getLoginFailure(emailExists: boolean | null) {
    return emailExists === false
        ? { field: "email" as const, message: LOGIN_UNKNOWN_EMAIL_ERROR }
        : { field: "form" as const, message: LOGIN_GENERIC_ERROR };
}
