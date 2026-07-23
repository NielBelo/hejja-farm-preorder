"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {
  error: null,
};

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    login,
    initialState
  );

  return (
    <form action={formAction} className="space-y-5">
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
            border border-gray-200
            bg-white
            px-4 py-2.5
            text-gray-700
            shadow-sm
            outline-none
            transition
          "
        />
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
            border border-gray-200
            bg-white
            px-4 py-2.5
            text-gray-700
            shadow-sm
            outline-none
            transition
          "
        />
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 shadow-sm">
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