"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getLoginFailure } from "@/lib/loginErrors";

export type LoginState = {
  error: string | null;
  emailError: string | null;
  passwordError: string | null;
  email: string;
};

function getSafeReturnTo(formData: FormData) {
  const value = formData.get("returnTo");

  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/preorder";
  }

  try {
    const url = new URL(value, "http://local");

    if (url.origin !== "http://local") {
      return "/preorder";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/preorder";
  }
}

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const emailError =
  email.trim() === "" ? "Az e-mail cím megadása kötelező." : null;

const passwordError =
  password.trim() === "" ? "A jelszó megadása kötelező." : null;

if (emailError || passwordError) {
  return {
    error: null,
    emailError,
    passwordError,

    email,
  };
}

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

if (error) {
  // Csak hibás belépési adatoknál nézzük meg, hogy a cím létezik-e (pl.
  // hálózati hibánál vagy sebességkorlátnál nem). Ha az ellenőrzés
  // sikertelen, az általános hibaüzenet marad.
  let emailExists: boolean | null = null;

  if (error.code === "invalid_credentials") {
    const { data, error: lookupError } = await supabase.rpc("login_email_exists", {
      p_email: email,
    });

    emailExists = !lookupError && typeof data === "boolean" ? data : null;
  }

  const failure = getLoginFailure(emailExists);

  return {
    error: failure.field === "form" ? failure.message : null,
    emailError: failure.field === "email" ? failure.message : null,
    passwordError: null,
    email,
  };
}

  redirect(getSafeReturnTo(formData));
}
