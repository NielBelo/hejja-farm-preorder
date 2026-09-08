import { buildOrderNotification } from "@/lib/email/orderNotification";
import { getLatestOrderUpdate } from "@/lib/email/latestOrderUpdate";
import { buildRegistrationConfirmation } from "@/lib/email/registrationConfirmation";
import { createClient } from "@/lib/supabase/server";
import EmailPreviewSwitcher from "./EmailPreviewSwitcher";

const sampleOrderData = {
    kind: "created" as const,
    orderId: 0,
    orderNumber: "HF-MINTA01",
    customerName: "Dániel",
    pickupDate: "2026-09-19",
    modificationWindowStart: "2026-09-07T08:00:00+02:00",
    modificationWindowEnd: "2026-09-16T23:59:00+02:00",
    items: [
        {
            productName: "Öko csirke",
            packageName: "Egész csirke",
            quantity: 2,
            sizePreference: "Közepes",
            note: null,
        },
        {
            productName: "Csirkemell filé",
            packageName: "Vákuumcsomagolt",
            quantity: 1,
            sizePreference: null,
            note: "Minta rendelési tétel",
        },
    ],
};

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Budapest",
    }).format(new Date(value));
}

export default async function AdminEmailPreviewPage({
    searchParams,
}: {
    searchParams: Promise<{ template?: string | string[] }>;
}) {
    const supabase = await createClient();
    const latestUpdate = await getLatestOrderUpdate(supabase);
    const params = await searchParams;
    const rawTemplate = params.template;
    const initialTemplate = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
    const orderData = latestUpdate?.notificationData ?? sampleOrderData;
    const createdOrderEmail = buildOrderNotification({ ...orderData, kind: "created" }, {
        logoSrc: "/images/logo2.png",
        orderUrl: orderData.orderId ? `/history?focusOrder=${orderData.orderId}#order-${orderData.orderId}` : "/history",
    });
    const updatedOrderEmail = buildOrderNotification({ ...orderData, kind: "updated" }, {
        logoSrc: "/images/logo2.png",
        orderUrl: orderData.orderId ? `/history?focusOrder=${orderData.orderId}#order-${orderData.orderId}` : "/history",
    });
    const registrationEmail = buildRegistrationConfirmation({
        firstName: "Dániel",
        confirmationUrl: "https://hejja-farm.hu/auth/confirm?token_hash=minta-token&type=email",
    }, {
        logoSrc: "/images/logo2.png",
    });
    const selectedTemplate = initialTemplate === "order-created" || initialTemplate === "order-updated"
        ? initialTemplate
        : "registration" as const;
    const previews = {
        registration: {
            subject: registrationEmail.subject,
            html: registrationEmail.html,
            iframeTitle: "Regisztráció-megerősítő e-mail",
            height: 850,
        },
        "order-created": {
            subject: createdOrderEmail.subject,
            html: createdOrderEmail.html,
            iframeTitle: "Új rendelés visszaigazoló e-mail",
            height: Math.max(760, 560 + orderData.items.length * 110),
        },
        "order-updated": {
            subject: updatedOrderEmail.subject,
            html: updatedOrderEmail.html,
            iframeTitle: "Rendelésmódosító e-mail",
            modifiedAt: latestUpdate?.modifiedAt,
            modifiedAtLabel: latestUpdate ? formatDateTime(latestUpdate.modifiedAt) : undefined,
            height: Math.max(760, 560 + orderData.items.length * 110),
        },
    };
    const useCases = {
        registration: "A vásárló a meghívásos regisztráció elküldése után kapja meg, hogy megerősítse e-mail-címét és aktiválja a fiókját.",
        "order-created": "A vásárló közvetlenül az új előrendelés leadása után kapja meg, amikor a rendszer sikeresen rögzítette a rendelését.",
        "order-updated": "A vásárló akkor kapja meg, amikor a korábban leadott rendelését módosítja, és a rendszer elmenti a változtatást.",
    };

    return (
        <EmailPreviewSwitcher
            selectedTemplate={selectedTemplate}
            preview={previews[selectedTemplate]}
            useCase={useCases[selectedTemplate]}
        />
    );
}
