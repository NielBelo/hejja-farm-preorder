import LoginForm from "./LoginForm";
import { LockClosedIcon } from "@heroicons/react/24/outline";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    registered?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const rawReturnTo = params.returnTo;
  const returnTo = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
  const rawRegistered = params.registered;
  const registered = Array.isArray(rawRegistered)
    ? rawRegistered[0] === "1"
    : rawRegistered === "1";
  const rawError = params.error;
  const confirmationError = Array.isArray(rawError)
    ? rawError[0] === "confirmation"
    : rawError === "confirmation";

  return (
    <main className="mx-auto mt-10 max-w-lg rounded-2xl bg-white px-6 py-10 shadow-lg sm:px-10 sm:py-12">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(49,171,2)]/15">
        <LockClosedIcon className="h-7 w-7 text-[rgb(49,171,2)]" />
      </div>

      <h1 className="mb-6 text-center text-xl font-bold text-gray-700 sm:text-2xl">
        Bejelentkezés
      </h1>

      {registered && (
        <p className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-center text-sm leading-6 text-green-700">
          A regisztráció sikerült! Küldtünk egy <strong>újabb e-mailt</strong>{" "}
          egy megerősítő linkkel — kattints rá, és az automatikusan
          bejelentkeztet a weboldalra. A megerősítés nélkül a fiókod{" "}
          <strong>nem fog működni</strong>.
        </p>
      )}

      {confirmationError && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
          A megerősítő link érvénytelen vagy lejárt. Kérj új meghívót, majd
          regisztrálj újra.
        </p>
      )}

      {!registered && <LoginForm returnTo={returnTo} />}
    </main>
  );
}
