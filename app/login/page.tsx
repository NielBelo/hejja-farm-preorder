import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-10 max-w-md rounded-xl border bg-white p-6 shadow">
      <h1 className="mb-6 text-2xl font-bold">
        Bejelentkezés
      </h1>

      <LoginForm />
    </main>
  );
}