import { supabase } from "@/lib/supabase"

export default async function Home() {
  const { data, error } = await supabase.from("products").select("*")

  return (
    <main>
      <h1>Supabase teszt</h1>

      <pre>{JSON.stringify({ data, error }, null, 2)}</pre>
    </main>
  )
}