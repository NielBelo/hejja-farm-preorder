"use client";

import Link from "next/link";
import { useActionState } from "react";
import FormInput from "@/components/FormInput";
import { register, type RegisterState } from "./actions";

const counties = [
  "Bács-Kiskun", "Baranya", "Békés", "Borsod-Abaúj-Zemplén", "Budapest",
  "Csongrád-Csanád", "Fejér", "Győr-Moson-Sopron", "Hajdú-Bihar", "Heves",
  "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád", "Pest", "Somogy",
  "Szabolcs-Szatmár-Bereg", "Tolna", "Vas", "Veszprém", "Zala",
];

const initialState: RegisterState = {
  error: null,
  success: null,
  fieldErrors: {},
  values: {},
};

export default function RegisterForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState(register, initialState);

  if (state.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-green-700">{state.success}</p>
        <Link href="/login" className="font-medium text-[rgb(49,171,2)] underline">
          Bejelentkezés
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      <input type="hidden" name="invite" value={token} />

      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-medium text-gray-700">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
          className="w-full cursor-not-allowed rounded-xl border-2 border-[rgba(7,109,143,0.2)] bg-gray-100 px-4 py-2.5 text-gray-700"
        />
      </div>

      <FormInput label="Vezetéknév" name="lastName" defaultValue={state.values.lastName} error={state.fieldErrors.lastName} />
      <FormInput label="Keresztnév" name="firstName" defaultValue={state.values.firstName} error={state.fieldErrors.firstName} />
      <FormInput label="Telefonszám" name="phone" type="tel" placeholder="+36 30 123 4567" defaultValue={state.values.phone} error={state.fieldErrors.phone} />

      <div>
        <label htmlFor="county" className="mb-2 block text-sm font-medium text-gray-700">
          Vármegye
        </label>
        <select
          id="county"
          name="county"
          defaultValue={state.values.county ?? ""}
          className="w-full rounded-xl border-2 border-[rgba(7,109,143,0.2)] bg-white px-4 py-2.5 text-gray-700 outline-none"
        >
          <option value="" disabled>Válasszon vármegyét</option>
          {counties.map((county) => <option key={county} value={county}>{county}</option>)}
        </select>
        {state.fieldErrors.county && <p className="mt-1 text-sm text-red-600">{state.fieldErrors.county}</p>}
      </div>

      <FormInput label="Település (nem kötelező)" name="city" defaultValue={state.values.city} />
      <FormInput label="Jelszó" name="password" type="password" error={state.fieldErrors.password} />
      <FormInput label="Jelszó újra" name="passwordConfirmation" type="password" error={state.fieldErrors.passwordConfirmation} />

      <div>
        <label className="flex items-start gap-3 text-sm text-gray-700">
          <input name="privacyAccepted" type="checkbox" value="true" className="mt-1 h-4 w-4" />
          <span>
            Elolvastam és elfogadom az{" "}
            <Link href="/privacy-policy" target="_blank" className="text-[rgb(49,171,2)] underline">
              adatkezelési tájékoztatót
            </Link>.
          </span>
        </label>
        {state.fieldErrors.privacyAccepted && <p className="mt-1 text-sm text-red-600">{state.fieldErrors.privacyAccepted}</p>}
      </div>

      {state.error && <p className="text-center text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-[rgb(49,171,2)] px-4 py-2.5 font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Regisztráció..." : "Regisztráció"}
      </button>
    </form>
  );
}
