import Image from "next/image";
import Navigation from "./Navigation";
import LogoutButton from "./LogoutButton";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export default async function Header() {
  const currentUser = await getCurrentUser();
  return (
    <header className="sticky top-4 z-50 mx-auto w-full max-w-5xl rounded-xl bg-white shadow-sm">
      <div className="px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/images/logo2.png"
              alt="Héjja Ökofarm"
              width={35}
              height={35}
              className="opacity-90"
              priority
            />

            <h1 className="text-2xl font-bold text-gray-700">
              Héjja Ökofarm
            </h1>
          </div>

          <Navigation />

          <LogoutButton
  userName={
    currentUser
      ? `${currentUser.lastName} ${currentUser.firstName}`
      : "Kijelentkezés"
  }
  
/>
        </div>
      </div>
    </header>
  );
}