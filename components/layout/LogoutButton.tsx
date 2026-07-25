"use client";

import { useState } from "react";
import Image from "next/image";
import { logout } from "@/app/logout/actions";

type LogoutButtonProps = {
  userName: string;
};

export default function LogoutButton({
  userName,
}: LogoutButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-gray-500 px-5 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-200"
      >
        {userName}

        <Image
          src="/images/logout.png"
          alt="Kijelentkezés"
          width={15}
          height={15}
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-800">
              Kijelentkezés
            </h2>

            <p className="mt-3 text-sm text-gray-600">
              Biztosan ki szeretnél jelentkezni?
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Mégse
              </button>

              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Kilépés
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}