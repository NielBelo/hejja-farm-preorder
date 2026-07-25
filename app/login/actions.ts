"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type LoginState = {
  error: string | null;
  emailError: string | null;
  passwordError: string | null;
};

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
  };
}

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

if (error) {
  return {
    error: "Hibás e-mail cím vagy jelszó.",
    emailError: null,
    passwordError: null,
  };
}

  redirect("/auth-test");
}