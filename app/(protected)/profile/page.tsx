import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ProfileEditor from "@/components/ProfileEditor";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone, county, city")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    console.error("Profil lekérdezési hiba:", error);

    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-red-600">
          A személyes adatok betöltése sikertelen.
        </p>
      </div>
    );
  }

  if (!user.email) {
    console.error("A felhasználóhoz nem tartozik e-mail cím.");

    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-red-600">
          A fiók e-mail címe nem tölthető be.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto mt-4 w-full max-w-5xl">

      {/* Tájékoztató rész */}
      <div className="mt-8 mb-12 w-full">
        <p className="text-base leading-7 text-justify text-gray-600">
          <span className="font-medium text-gray-700">
            Az itt megjelenő adatok a Héjja-Farm rendszerében Önről
            tárolt személyes és kapcsolattartási adatok.
          </span>{" "}
          Ezeket a felhasználói fiók azonosításához, az előrendelések
          kezeléséhez, valamint az átvétellel kapcsolatos
          kapcsolattartáshoz használjuk. Adatait ezen az oldalon
          bármikor áttekintheti és módosíthatja.
        </p>
      </div>

      {/* Vásárlói adatlap */}
      <div className="mx-auto w-full max-w-3xl">
        <ProfileEditor
          userId={user.id}
          email={user.email}
          profile={profile}
        />
      </div>

    </main>
  );
}