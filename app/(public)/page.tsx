import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

export const metadata: Metadata = {
  title: "Héjja Ökofarm",
  description: "Héjja Ökofarm – online csirke-előrendelés.",
};

const CONTACT_EMAIL = "hejjaokofarm@gmail.com";

export default function HomePage() {
  return (
    <main className="mx-auto mt-10 max-w-lg rounded-2xl bg-white px-6 py-10 text-center shadow-lg sm:px-10 sm:py-12">
      <h1 className="text-xl font-bold text-gray-700 sm:text-2xl">
        Üdvözlünk a Héjja Ökofarm csirke-előrendelő oldalán!
      </h1>

      <p className="mx-auto mt-4 max-w-sm text-gray-600">
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

      <div className="mt-8 border-t border-gray-100 pt-8">
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[rgb(49,171,2)] px-4 py-2.5 font-medium text-white shadow-sm transition hover:brightness-95 sm:w-auto sm:px-8"
        >
          Bejelentkezés
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </main>
  );
}
