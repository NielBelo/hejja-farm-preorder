import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-6 text-2xl font-bold text-gray-700 text-center">
        Bejelentkezés
      </h1>

      <LoginForm />
    </main>
  );
}