import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const rawReturnTo = (await searchParams).returnTo;
  const returnTo = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;

  return (
    <main className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-gray-700 text-center">
        Bejelentkezés
      </h1>

      <LoginForm returnTo={returnTo} />
    </main>
  );
}
