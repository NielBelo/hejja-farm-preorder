import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  isAdmin: boolean;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone, city")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? "",
    firstName: profile.first_name,
    lastName: profile.last_name,
    phone: profile.phone,
    city: profile.city,
    isAdmin: false, // később adatbázisból érkezik
  };
}