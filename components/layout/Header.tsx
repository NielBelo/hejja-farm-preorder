import Navigation from "./Navigation";
import LogoutButton from "./LogoutButton";
import Logo from "./Logo";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

export default async function Header() {
  const currentUser = await getCurrentUser();

  return (
    <header className="sticky top-4 z-50 mx-auto w-[calc(100%-2rem)] max-w-[68rem] rounded-xl bg-white shadow-sm">
      <div className="px-4 py-3 sm:px-5">
        <div className="grid grid-cols-2 items-center gap-y-2 sm:grid-cols-[auto_1fr_auto] sm:gap-x-3">
          <div className="flex items-center gap-3">
            <Logo />
          </div>

          <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <Navigation isAdmin={currentUser?.isAdmin ?? false} />
          </div>

          <div className="justify-self-end sm:col-start-3 sm:row-start-1">
            <LogoutButton
              userName={
                currentUser
                  ? `${currentUser.lastName} ${currentUser.firstName}`
                  : "Kijelentkezés"
              }
            />
          </div>
        </div>
      </div>
    </header>
  );
}
