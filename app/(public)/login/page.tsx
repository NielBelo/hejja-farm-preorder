import LoginForm from "./LoginForm";

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
    <main className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-gray-700 text-center">
        Bejelentkezés
      </h1>

      {registered && (
        <p className="mb-6 rounded-lg border border-green-200 bg-green-50 p-3 text-center text-sm text-green-700">
          A regisztráció sikerült. A bejelentkezés előtt erősítsd meg az
          e-mail-címedet a kiküldött levélben található linkkel.
        </p>
      )}

      {confirmationError && (
        <p className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm text-red-700">
          A megerősítő link érvénytelen vagy lejárt. Kérj új meghívót, majd
          regisztrálj újra.
        </p>
      )}

      <LoginForm returnTo={returnTo} />
    </main>
  );
}
