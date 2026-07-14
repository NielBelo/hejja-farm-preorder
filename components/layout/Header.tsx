import Image from "next/image";
import Navigation from "./Navigation";

export default function Header() {
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

          <button className="flex items-center gap-3 rounded-xl border border-gray-500 px-5 py-3 
          text-sm font-bold text-gray-700 transition hover:bg-gray-200">
  Kiss Dániel

  <Image
    src="/images/logout.png"
    alt="Kijelentkezés"
    width={15}
    height={15}
  />
</button>
        </div>
      </div>
    </header>
  );
}