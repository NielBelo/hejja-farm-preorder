"use client";

import Link from "next/link";
import { CheckIcon, ChevronDownIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { useActionState, useEffect, useRef, useState } from "react";
import FormInput from "@/components/FormInput";
import { register, type RegisterState } from "./actions";
import { formatHungarianPhoneInput as formatPhoneInput, normalizeHungarianPhone } from "@/lib/phoneNumber";

const counties = ["Bács-Kiskun", "Baranya", "Békés", "Borsod-Abaúj-Zemplén", "Budapest", "Csongrád-Csanád", "Fejér", "Győr-Moson-Sopron", "Hajdú-Bihar", "Heves", "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád", "Pest", "Somogy", "Szabolcs-Szatmár-Bereg", "Tolna", "Vas", "Veszprém", "Zala"];
const initialState: RegisterState = { error: null, success: null, fieldErrors: {}, values: {} };

async function previewRegister(_previous: RegisterState, formData: FormData): Promise<RegisterState> {
  const value = (name: string) => {
    const input = formData.get(name);
    return typeof input === "string" ? input.trim() : "";
  };
  const phoneInput = value("phone");
  const normalizedPhone = normalizeHungarianPhone(phoneInput);
  const values = {
    firstName: value("firstName"), lastName: value("lastName"), phone: phoneInput,
    county: value("county"), city: value("city"), privacyAccepted: formData.get("privacyAccepted") === "true",
  };
  const fieldErrors: RegisterState["fieldErrors"] = {};
  if (!values.firstName) fieldErrors.firstName = "A keresztnév megadása kötelező.";
  if (!values.lastName) fieldErrors.lastName = "A vezetéknév megadása kötelező.";
  if (!normalizedPhone) fieldErrors.phone = "Kérjük, adjon meg érvényes magyar telefonszámot.";
  if (!values.county) fieldErrors.county = "A megye kiválasztása kötelező.";
  if (!values.city) fieldErrors.city = "A település megadása kötelező.";
  if (value("password").length < 6) fieldErrors.password = "A jelszónak legalább 6 karakter hosszúnak kell lennie.";
  if (value("password") !== value("passwordConfirmation")) fieldErrors.passwordConfirmation = "A két jelszó nem egyezik.";
  if (!values.privacyAccepted) fieldErrors.privacyAccepted = "Az adatkezelési tájékoztató elfogadása kötelező.";
  if (Object.keys(fieldErrors).length) return { error: null, success: null, fieldErrors, values };
  return { error: null, success: "Sikeresen rögzítettük az adataidat. Hamarosan kapsz egy e-mailt; a benne lévő megerősítő linkre kattintva fejezheted be a regisztrációt.", fieldErrors: {}, values: {} };
}

function RequiredLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-gray-700">{children} <span className="text-red-600" aria-hidden="true">*</span></label>;
}

function CountySelect({ initialValue, error }: { initialValue: string; error?: string }) {
  const [value, setValue] = useState(initialValue);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return <div ref={ref} className="relative">
    <RequiredLabel>Megye</RequiredLabel><input type="hidden" name="county" value={value} />
    <button type="button" onClick={() => setIsOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={isOpen} className={`flex w-full items-center justify-between rounded-lg border bg-white px-4 py-3 text-left text-base outline-none transition ${error ? "border-red-400" : isOpen ? "border-[rgb(49,171,2)] ring-2 ring-[rgb(49,171,2)]/10" : "border-gray-300"}`}>
      <span className={value ? "text-gray-800" : "text-gray-400"}>{value || "Válasszon megyét"}</span><ChevronDownIcon className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
    </button>
    {isOpen && <div role="listbox" className="absolute z-40 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
      {counties.map((county) => <button key={county} type="button" role="option" aria-selected={county === value} onClick={() => { setValue(county); setIsOpen(false); }} className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-base text-gray-800 hover:bg-[#F0FAEE] ${county === value ? "bg-[#F0FAEE] font-medium" : ""}`}>{county}{county === value && <CheckIcon className="h-5 w-5 text-[rgb(49,171,2)]" />}</button>)}
    </div>}
    {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
  </div>;
}

function PasswordField({ name, label, error }: { name: "password" | "passwordConfirmation"; label: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  return <div><RequiredLabel htmlFor={name}>{label}</RequiredLabel><div className="relative"><input id={name} name={name} type={visible ? "text" : "password"} className={`w-full rounded-xl border-2 bg-white px-4 py-2.5 pr-12 text-gray-700 outline-none ${error ? "border-red-400" : "border-[rgba(7,109,143,0.2)]"}`} /><button type="button" onClick={() => setVisible((value) => !value)} className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700" aria-label={visible ? "Jelszó elrejtése" : "Jelszó megjelenítése"}>{visible ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}</button></div>{error && <p className="mt-1 text-sm text-red-600">{error}</p>}</div>;
}

export function RegistrationSuccessMessage() {
  return <p className="rounded-lg border border-green-200 bg-green-50 p-4 leading-6 text-center text-green-800">Sikeresen rögzítettük az adataidat. Hamarosan kapsz egy e-mailt; a benne lévő megerősítő linkre kattintva fejezheted be a regisztrációt.</p>;
}

export default function RegisterForm({ token, email, preview = false }: { token: string; email: string; preview?: boolean }) {
  const [state, formAction, isPending] = useActionState(preview ? previewRegister : register, initialState);
  if (state.success) return <div className="space-y-4 text-center"><RegistrationSuccessMessage /></div>;
  return <form key={JSON.stringify(state.values)} action={formAction} noValidate className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
    <input type="hidden" name="invite" value={token} />
    <div className="sm:col-span-2"><RequiredLabel htmlFor="email">E-mail</RequiredLabel><input id="email" name="email" type="email" value={email} readOnly aria-readonly="true" className="w-full cursor-not-allowed rounded-xl border-2 border-[rgba(7,109,143,0.2)] bg-gray-100 px-4 py-2.5 text-gray-700" /></div>
    <FormInput label="Vezetéknév *" name="lastName" defaultValue={state.values.lastName} error={state.fieldErrors.lastName} />
    <FormInput label="Keresztnév *" name="firstName" defaultValue={state.values.firstName} error={state.fieldErrors.firstName} />
    <div><RequiredLabel htmlFor="phone">Telefonszám</RequiredLabel><input id="phone" name="phone" type="tel" inputMode="tel" placeholder="+36 30 123 4567" defaultValue={state.values.phone ? formatPhoneInput(state.values.phone) : "+36"} onChange={(event) => { event.currentTarget.value = formatPhoneInput(event.currentTarget.value); }} className={`w-full rounded-xl border-2 bg-white px-4 py-2.5 text-gray-700 outline-none ${state.fieldErrors.phone ? "border-red-400" : "border-[rgba(7,109,143,0.2)]"}`} />{state.fieldErrors.phone && <p className="mt-1 text-sm text-red-600">{state.fieldErrors.phone}</p>}</div>
    <CountySelect initialValue={state.values.county ?? ""} error={state.fieldErrors.county} />
    <FormInput label="Település *" name="city" defaultValue={state.values.city} error={state.fieldErrors.city} />
    <div className="hidden sm:block" aria-hidden="true" />
    <PasswordField label="Jelszó" name="password" error={state.fieldErrors.password} /><PasswordField label="Jelszó újra" name="passwordConfirmation" error={state.fieldErrors.passwordConfirmation} />
    <div className="sm:col-span-2"><label className="flex items-start gap-3 text-sm text-gray-700"><input name="privacyAccepted" type="checkbox" value="true" defaultChecked={state.values.privacyAccepted} className="mt-1 h-4 w-4" /><span>Elolvastam és elfogadom az <Link href="/privacy-policy" target="_blank" className="text-[rgb(49,171,2)] underline">adatkezelési tájékoztatót</Link>.<span className="ml-1 text-red-600" aria-hidden="true">*</span></span></label>{state.fieldErrors.privacyAccepted && <p className="mt-1 text-sm text-red-600">{state.fieldErrors.privacyAccepted}</p>}</div>
    <p className="sm:col-span-2 text-sm text-gray-500"><span className="text-red-600">*</span> A csillaggal jelölt mezők kitöltése kötelező.</p>
    {state.error && <p className="sm:col-span-2 text-center text-sm text-red-600">{state.error}</p>}
    <button type="submit" disabled={isPending} className="sm:col-span-2 w-full rounded-xl bg-[rgb(49,171,2)] px-4 py-2.5 font-medium text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">{isPending ? "Regisztráció..." : "Regisztráció"}</button>
  </form>;
}
