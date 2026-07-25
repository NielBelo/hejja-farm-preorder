"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";
import FormInput from "@/components/FormInput";


const initialState: LoginState = {
  error: null,
  emailError: null,
  passwordError: null,
  email: "",
};


export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    login,
    initialState
  );

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormInput
        label="E-mail"
        name="email"
        type="email"
        defaultValue={state.email}
        error={state.emailError}
      />

      <FormInput
        label="Jelszó"
        name="password"
        type="password"
        error={state.passwordError}
      />

      {state.error && (
        <p className="py-1 text-center text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="
          w-full
          rounded-xl
          bg-[rgb(49,171,2)]
          px-4
          py-2.5
          font-medium
          text-white
          shadow-sm
          transition
          hover:brightness-95
          disabled:cursor-not-allowed
          disabled:opacity-60
        "
      >
        {isPending ? "Bejelentkezés..." : "Bejelentkezés"}
      </button>
    </form>
  );
}