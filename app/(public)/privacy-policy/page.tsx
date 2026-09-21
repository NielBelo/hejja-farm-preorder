import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto mt-10 max-w-3xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="mb-4 text-2xl font-bold text-gray-700">
        Adatkezelési tájékoztató
      </h1>

      <PrivacyPolicyContent />
    </main>
  );
}
