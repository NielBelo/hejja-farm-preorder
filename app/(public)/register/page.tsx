import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import RegisterForm from "./RegisterForm";

type InviteResult = {
  status: "valid" | "used" | "invalid";
  email: string | null;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const token = first((await searchParams).invite)?.trim() ?? "";
  let invite: InviteResult = { status: "invalid", email: null };

  if (token) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("validate_registration_invite", {
      invite_token: token,
    });

    if (!error && Array.isArray(data) && data[0]) {
      invite = data[0] as InviteResult;
    } else if (error) {
      console.error("Meghívó ellenőrzési hiba:", error.message);
    }
  }

  if (invite.status !== "valid" || !invite.email) {
    const message =
      invite.status === "used"
        ? "Ezt a meghívót már felhasználták. Ha már van fiókod, jelentkezz be."
        : "A meghívó érvénytelen vagy nem létezik.";

    return (
      <main className="mx-auto mt-10 max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="mb-4 text-center text-2xl font-bold text-gray-700">
          Regisztráció
        </h1>
        <p className="text-center text-red-600">{message}</p>
        <Link
          href="/login"
          className="mt-6 block text-center font-medium text-[rgb(49,171,2)] underline"
        >
          Bejelentkezés
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto mt-10 max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="mb-6 text-center text-2xl font-bold text-gray-700">
        Regisztráció
      </h1>
      <RegisterForm token={token} email={invite.email} />
    </main>
  );
}
