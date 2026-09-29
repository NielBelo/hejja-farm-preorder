import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, MapPinIcon, PhoneIcon, UserIcon } from "@heroicons/react/24/outline";

export const metadata: Metadata = {
  title: "Héjja Ökofarm",
  description: "Héjja Ökofarm – online csirke-előrendelés.",
};

const CONTACT_EMAIL = "hejjaokofarm@gmail.com";
const CONTACT_PHONE = "30/616-83-68";
const CONTACT_PHONE_HREF = "+36306168368";

export default function HomePage() {
  return (
    <main className="mx-auto mt-10 max-w-2xl rounded-2xl bg-white px-8 py-12 text-center shadow-lg sm:px-14 sm:py-16">
      <h1 className="text-2xl font-bold text-gray-700 sm:text-3xl">
        Üdvözlünk a Héjja Ökofarm csirke-előrendelő oldalán!
      </h1>

      <p className="mx-auto mt-5 max-w-md text-base text-gray-600 sm:text-lg">
        Az oldal használata regisztrációhoz kötött. Regisztrációs
        meghívóért vedd fel velünk a kapcsolatot a{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="font-medium text-[rgb(49,171,2)] underline decoration-[rgb(49,171,2)]/40 underline-offset-2 transition hover:decoration-[rgb(49,171,2)]"
        >
          {CONTACT_EMAIL}
        </a>{" "}
        <span className="whitespace-nowrap">e-mail-címen.</span>
      </p>

      <div className="mt-8">
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[rgb(49,171,2)] px-4 py-3 text-base font-medium text-white shadow-sm transition hover:brightness-95 sm:w-auto sm:px-8 sm:text-lg"
        >
          Bejelentkezés
          <ArrowRightIcon className="h-4 w-4 sm:h-5 sm:w-5" />
        </Link>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-gray-600/20 pt-6 text-sm text-gray-600">
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="h-4 w-4" />
          Hódmezővásárhely-Kútvölgy, Tanya 1132.
        </span>
        <span className="hidden sm:inline">·</span>
        <span className="inline-flex items-center gap-1">
          <UserIcon className="h-4 w-4" />
          Héjja Zalán
        </span>
        <span className="hidden sm:inline">·</span>
        <span className="inline-flex items-center gap-1">
          <PhoneIcon className="h-4 w-4" />
          <a href={`tel:${CONTACT_PHONE_HREF}`}>{CONTACT_PHONE}</a>
        </span>
      </div>
    </main>
  );
}
