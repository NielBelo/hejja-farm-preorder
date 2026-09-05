import { buildOrderNotification } from "@/lib/email/orderNotification";
import { getLatestOrderUpdate } from "@/lib/email/latestOrderUpdate";
import { createClient } from "@/lib/supabase/server";

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Budapest",
    }).format(new Date(value));
}

export default async function AdminEmailPreviewPage() {
    const supabase = await createClient();
    const latestUpdate = await getLatestOrderUpdate(supabase);

    if (!latestUpdate) {
        return (
            <div className="mx-auto w-full max-w-3xl">
                <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
                    <h1 className="text-xl font-semibold text-gray-900">
                        Rendelésmódosító e-mail
                    </h1>
                    <p className="mt-3 text-gray-600">
                        Még nincs megjeleníthető rendelésmódosítás.
                    </p>
                </div>
            </div>
        );
    }

    const email = buildOrderNotification(latestUpdate.notificationData, {
        logoSrc: "/images/logo2.png",
        orderUrl: `/history?focusOrder=${latestUpdate.notificationData.orderId}#order-${latestUpdate.notificationData.orderId}`,
    });

    return (
        <div className="mx-auto w-full max-w-3xl">
            <div className="px-4 text-center sm:px-6">
                <h1 className="text-2xl font-semibold text-gray-900">
                    Rendelésmódosító e-mail
                </h1>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-600">
                    A legutóbbi rendelésmódosítás után kiküldött e-mail előnézete.
                </p>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
                    <dl className="grid gap-3 text-sm">
                        <div className="grid grid-cols-[5rem_1fr] gap-3">
                            <dt className="font-medium text-gray-500">Tárgy</dt>
                            <dd className="font-medium text-gray-900">{email.subject}</dd>
                        </div>
                        <div className="grid grid-cols-[5rem_1fr] gap-3">
                            <dt className="font-medium text-gray-500">Módosítva</dt>
                            <dd className="text-gray-700">
                                <time dateTime={latestUpdate.modifiedAt}>
                                    {formatDateTime(latestUpdate.modifiedAt)}
                                </time>
                            </dd>
                        </div>
                    </dl>
                </div>

                <div className="bg-[#f4f7f5] p-3 sm:p-6">
                    <iframe
                        title="Rendelésmódosító e-mail előnézete"
                        srcDoc={email.html}
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        className="w-full rounded-xl border-0 bg-[#f4f7f5]"
                        style={{
                            height: Math.max(
                                760,
                                560 + latestUpdate.notificationData.items.length * 110,
                            ),
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
