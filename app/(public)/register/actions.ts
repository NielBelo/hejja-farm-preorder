"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeHungarianPhone } from "@/lib/phoneNumber";

export type RegisterState = {
  error: string | null;
  success: string | null;
  fieldErrors: Partial<Record<"firstName" | "lastName" | "phone" | "county" | "city" | "password" | "passwordConfirmation" | "privacyAccepted", string>>;
  values: Partial<Record<"firstName" | "lastName" | "phone" | "county" | "city", string>> & { privacyAccepted?: boolean };
};

const textValue = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const PRODUCTION_SITE_URL = "https://hejja-farm.hu";

export async function register(_previous: RegisterState, formData: FormData): Promise<RegisterState> {
  const invite = textValue(formData, "invite");
  const submittedEmail = normalizeEmail(textValue(formData, "email"));
  const firstName = textValue(formData, "firstName");
  const lastName = textValue(formData, "lastName");
  const phoneInput = textValue(formData, "phone");
  const phone = normalizeHungarianPhone(phoneInput);
  const county = textValue(formData, "county");
  const city = textValue(formData, "city");
  const password = textValue(formData, "password");
  const passwordConfirmation = textValue(formData, "passwordConfirmation");
  const privacyAccepted = formData.get("privacyAccepted") === "true";
  const values = { firstName, lastName, phone: phoneInput, county, city, privacyAccepted };
  const fieldErrors: RegisterState["fieldErrors"] = {};

  if (!firstName) fieldErrors.firstName = "A keresztnév megadása kötelező.";
  if (!lastName) fieldErrors.lastName = "A vezetéknév megadása kötelező.";
  if (!phone) fieldErrors.phone = "Kérjük, adjon meg érvényes magyar telefonszámot.";
  if (!county) fieldErrors.county = "A megye kiválasztása kötelező.";
  if (!city) fieldErrors.city = "A település megadása kötelező.";
  if (password.length < 6) fieldErrors.password = "A jelszónak legalább 6 karakter hosszúnak kell lennie.";
  if (password !== passwordConfirmation) fieldErrors.passwordConfirmation = "A két jelszó nem egyezik.";
  if (!privacyAccepted) fieldErrors.privacyAccepted = "Az adatkezelési tájékoztató elfogadása kötelező.";

  if (!invite || Object.keys(fieldErrors).length > 0) {
    return { error: invite ? null : "A meghívó érvénytelen.", success: null, fieldErrors, values };
  }

  const supabase = await createClient();
  const { data: inviteRows, error: inviteError } = await supabase.rpc("validate_registration_invite", {
    invite_token: invite,
  });
  const inviteResult = Array.isArray(inviteRows) ? inviteRows[0] as { status?: string; email?: string | null } | undefined : undefined;

  if (inviteError || !inviteResult || inviteResult.status === "invalid") {
    return { error: "A meghívó érvénytelen vagy nem létezik.", success: null, fieldErrors: {}, values };
  }
  if (inviteResult.status === "used") {
    return { error: "Ezt a meghívót már felhasználták. Ha már van fiókod, jelentkezz be.", success: null, fieldErrors: {}, values };
  }

  const invitedEmail = normalizeEmail(inviteResult.email ?? "");
  if (!invitedEmail || submittedEmail !== invitedEmail) {
    return { error: "Ezzel a meghívóval csak a meghívott e-mail címmel lehet regisztrálni.", success: null, fieldErrors: {}, values };
  }

  const { error: signUpError } = await supabase.auth.signUp({
    email: invitedEmail,
    password,
    options: {
      emailRedirectTo: `${PRODUCTION_SITE_URL}/auth/confirm`,
      data: {
        registration_invite_token: invite,
        privacy_policy_accepted: true,
        first_name: firstName,
        last_name: lastName,
        phone,
        county,
        city,
      },
    },
  });

  if (signUpError) {
    console.error("Supabase regisztrációs hiba:", {
      name: signUpError.name,
      message: signUpError.message,
      status: signUpError.status,
      code: signUpError.code,
    });

    const { data: refreshedRows } = await supabase.rpc("validate_registration_invite", { invite_token: invite });
    const refreshed = Array.isArray(refreshedRows) ? refreshedRows[0] as { status?: string } | undefined : undefined;
    const error = refreshed?.status === "used"
      ? "Ezt a meghívót már felhasználták. Ha már van fiókod, jelentkezz be."
      : "A regisztráció sikertelen. Kérjük, próbálja újra.";
    return { error, success: null, fieldErrors: {}, values };
  }

  // A Supabase az e-mail-felderítés megakadályozására már létező címnél is
  // adhat látszólag sikeres választ. Valódi siker csak a DB-trigger által
  // atomikusan elfogyasztott meghívó.
  const { data: consumedRows, error: consumedError } = await supabase.rpc(
    "validate_registration_invite",
    { invite_token: invite },
  );
  const consumed = Array.isArray(consumedRows)
    ? consumedRows[0] as { status?: string } | undefined
    : undefined;

  if (consumedError || consumed?.status !== "used") {
    return {
      error: "A regisztráció nem fejeződött be. Lehet, hogy ehhez az e-mail címhez már tartozik fiók.",
      success: null,
      fieldErrors: {},
      values,
    };
  }

  redirect("/login?registered=1");
}
