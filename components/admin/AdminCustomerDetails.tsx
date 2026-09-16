import {
    EnvelopeIcon,
    MapIcon,
    MapPinIcon,
    PhoneIcon,
    UserIcon,
} from "@heroicons/react/24/outline";
import type { AdminOrder } from "@/components/admin/AdminOrderCard";

export default function AdminCustomerDetails({ order, id }: {
    order: Pick<AdminOrder, "profile">;
    id: string;
}) {
    const profile = order.profile;
    const fields = [
        {
            label: "Név",
            value: [profile?.last_name, profile?.first_name]
                .map((name) => name?.trim()).filter(Boolean).join(" "),
            icon: UserIcon,
        },
        { label: "E-mail cím", value: profile?.email, icon: EnvelopeIcon },
        {
            label: "Telefonszám",
            value: profile?.phone?.replace(/^(\+36)(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4"),
            icon: PhoneIcon,
        },
        { label: "Vármegye", value: profile?.county, icon: MapIcon },
        { label: "Település", value: profile?.city, icon: MapPinIcon },
    ];

    return (
        <section id={id} aria-labelledby={`${id}-heading`} className="mt-4">
            <h3 id={`${id}-heading`} className="text-center font-semibold text-gray-800">
                Felhasználó adatai
            </h3>

            {profile ? (
                <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    {fields.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex min-w-0 items-start gap-2 py-2">
                            <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                            <div className="min-w-0">
                                <dt className="text-xs font-medium text-gray-500">{label}</dt>
                                <dd className="text-sm font-medium text-gray-700 [overflow-wrap:anywhere]">
                                    {value?.trim() || <span className="font-normal text-gray-400">Nincs megadva</span>}
                                </dd>
                            </div>
                        </div>
                    ))}
                </dl>
            ) : (
                <p className="mt-4 text-center text-sm text-gray-500">
                    A felhasználó személyes adatai nem érhetők el.
                </p>
            )}
        </section>
    );
}
