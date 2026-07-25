"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";


const initialState: LoginState = {
  error: null,
  emailError: null,
  passwordError: null,
};


export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    login,
    initialState
  );

  return (
    <form action={formAction} noValidate className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          E-mail
        </label>

        <input
          type="email"
          name="email"
          required
          className="
            w-full
            rounded-xl
            border-2 border-[rgba(7,109,143,0.2)]
            bg-white
            px-4 py-2.5
            text-gray-700
            outline-none
            transition
          "
        />
        {state.emailError && (
          <p className="mt-1 text-sm text-red-600">
            {state.emailError}
          </p>
        )}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700">
          Jelszó
        </label>

        <input
          type="password"
          name="password"
          required
          className="
            w-full
            rounded-xl
            border-2 border-[rgba(7,109,143,0.2)]
            bg-white
            px-4 py-2.5
            text-gray-700
            outline-none
            transition
          "
        />
        {state.passwordError && (
          <p className="mt-1 text-sm text-red-600">
            {state.passwordError}
          </p>
        )}
      </div>

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