import { createClient } from "@/lib/supabase/server";

export default async function AuthTestPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto mt-10 max-w-3xl rounded-xl border bg-white p-6 shadow">
      <h1 className="mb-6 text-2xl font-bold">Supabase Auth teszt</h1>

      {user ? (
        <>
          <p className="text-green-600 font-semibold">
            ✅ Bejelentkezve
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <p>
              <strong>ID:</strong> {user.id}
            </p>

            <p>
              <strong>E-mail:</strong> {user.email}
            </p>
          </div>
        </>
      ) : (
        <p className="text-red-600 font-semibold">
          ❌ Nincs bejelentkezve
        </p>
      )}
    </main>
  );
}