"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  {
    label: "Előrendelés",
    href: "/preorder",
  },
  {
    label: "Előzmények",
    href: "/products",
  },
  {
    label: "Beállítások",
    href: "/settings",
  },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-white rounded-md">
      <div className="flex gap-1">
        {menuItems.map((item) => {
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
      </div>
    </nav>
  );
}