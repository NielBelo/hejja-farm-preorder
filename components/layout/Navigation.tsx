"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const menuItems = [
  {
    label: "Előrendelés",
    href: "/preorder",
  },
  {
    label: "Előzmények",
    href: "/history",
  },
  {
    label: "Személyes adatok",
    href: "/profile",
  },
];

const adminMenuItems = [
  {
    label: "Rendelések",
    href: "/admin/orders",
  },
  {
    label: "E-mail előnézet",
    href: "/admin/email-preview",
  },
  {
    label: "Rendelésátvétel",
    href: "/admin/pickup",
  },
];

export default function Navigation({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isUserSectionActive = menuItems.some(
    (item) =>
      pathname === item.href ||
      pathname.startsWith(item.href + "/")
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <nav className="rounded-md bg-white">
      <div className="flex items-center gap-1">

        {/* Normál felhasználó */}
        {!isAdmin &&
          menuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  px-2 py-2 text-base transition-all
                  ${
                    isActive
                      ? "text-[rgb(49,171,2)]"
                      : "text-gray-500/80 hover:text-gray-700"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}

        {/* Admin funkciók */}
        {isAdmin &&
          adminMenuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  px-2 py-2 text-base transition-all
                  ${
                    isActive
                      ? "text-[rgb(49,171,2)]"
                      : "text-gray-500/80 hover:text-gray-700"
                  }
                `}
              >
                {item.label}
              </Link>
            );
          })}

        {/* Admin: felhasználói funkciók dropdown */}
        {isAdmin && (
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((open) => !open)}
              className={`
                flex items-center gap-1 px-2 py-2 text-base transition-all
                ${
                  isUserSectionActive
                    ? "text-[rgb(49,171,2)]"
                    : "text-gray-500/80 hover:text-gray-700"
                }
              `}
            >
              Felhasználói funkciók

              <svg
                className={`h-4 w-4 transition-transform ${
                  userMenuOpen ? "rotate-180" : ""
                }`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-52 rounded-lg border border-gray-100 bg-white p-1 shadow-lg">
                {menuItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setUserMenuOpen(false)}
                      className={`
                        block rounded-md px-3 py-2 text-sm transition-all
                        ${
                          isActive
                            ? "bg-gray-50 text-[rgb(49,171,2)]"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                        }
                      `}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
