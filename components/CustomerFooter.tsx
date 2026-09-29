import {
  EnvelopeIcon,
  MapPinIcon,
  PhoneIcon,
  ShoppingBagIcon,
  UserIcon,
} from "@heroicons/react/24/outline";

const CONTACT_EMAIL = "hejjaokofarm@gmail.com";
const CONTACT_PHONE = "+36 30 616 8368";

export default function CustomerFooter() {
  return (
    <footer className="mx-auto mt-10 w-full max-w-[68rem] border-t border-gray-200 px-4 pb-6 pt-6 sm:px-5">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-sm text-gray-600 lg:flex-nowrap">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ShoppingBagIcon className="h-4 w-4 shrink-0 text-gray-400" />
          Héjja Ökofarm
        </span>
        <span className="hidden text-gray-300 lg:inline">·</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <MapPinIcon className="h-4 w-4 shrink-0 text-gray-400" />
          Hódmezővásárhely-Kútvölgy, Tanya 1132.
        </span>
        <span className="hidden text-gray-300 lg:inline">·</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <UserIcon className="h-4 w-4 shrink-0 text-gray-400" />
          Héjja Zalán
        </span>
        <span className="hidden text-gray-300 lg:inline">·</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PhoneIcon className="h-4 w-4 shrink-0 text-gray-400" />
          {CONTACT_PHONE}
        </span>
        <span className="hidden text-gray-300 lg:inline">·</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <EnvelopeIcon className="h-4 w-4 shrink-0 text-gray-400" />
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline decoration-gray-300 underline-offset-2 transition hover:text-gray-800 hover:decoration-gray-500"
          >
            {CONTACT_EMAIL}
          </a>
        </span>
      </div>
    </footer>
  );
}
