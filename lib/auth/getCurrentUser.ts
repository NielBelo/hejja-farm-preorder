import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  city: string;
  county: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  specialSizePreference: "smaller" | "larger" | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: userRole } = await supabase
  .from("user_roles")
  .select("role, is_superadmin")
  .eq("user_id", user.id)
  .single();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, phone, city, county, special_size_preference")
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
    county: profile.county,
    isAdmin: userRole?.role === "admin",
    isSuperAdmin: userRole?.role === "admin" && userRole?.is_superadmin === true,
    specialSizePreference: profile.special_size_preference ?? null,
  };
});