import { buildOrderNotification } from "@/lib/email/orderNotification";
import { getLatestOrderUpdate } from "@/lib/email/latestOrderUpdate";
import { buildRegistrationConfirmation } from "@/lib/email/registrationConfirmation";
import { buildRegistrationInvite } from "@/lib/email/registrationInvite";
import RegisterForm, { RegistrationSuccessMessage } from "@/app/(public)/register/RegisterForm";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import EmailPreviewSwitcher from "./EmailPreviewSwitcher";

const sampleOrderData = {
    kind: "created" as const,
    orderId: 0,
    orderNumber: "HF-MINTA01",
    customerName: "Dániel",
    pickupDate: "2026-09-19",
    pickupTimeStart: "17:00",
    pickupTimeEnd: "18:15",
    localPickupTimeStart: "16:00",
    county: null as string | null,
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
    const [latestUpdate, currentUser] = await Promise.all([
        getLatestOrderUpdate(supabase),
        getCurrentUser(),
    ]);
    const params = await searchParams;
    const rawTemplate = params.template;
    const initialTemplate = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
    // A megye mindig a bejelentkezett admin valódi profilbeállítása - lásd az
    // OrderConfirmationSummary "/admin/order-confirmation-preview" előnézetét,
    // ami ugyanígy jár el, hogy a Békés/nem Békés ág valós adattal
    // ellenőrizhető legyen, admin által kezelt megyeválasztó nélkül.
    const orderData = {
        ...(latestUpdate?.notificationData ?? sampleOrderData),
        county: currentUser?.county ?? null,
    };
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
        confirmationUrl: "https://hejja-okofarm.hu/auth/confirm?token_hash=minta-token&type=email",
    }, {
        logoSrc: "/images/logo2.png",
    });
    const inviteEmail = buildRegistrationInvite({
        recipientName: "Dániel",
        invitationUrl: "https://hejja-okofarm.hu/register?invite=minta-egyszer-hasznalatos-token",
    });
    const selectedTemplate = initialTemplate === "registration" || initialTemplate === "registration-confirmation" || initialTemplate === "order-created" || initialTemplate === "order-updated" || initialTemplate === "registration-invite"
        ? initialTemplate
        : "registration-invite" as const;
    const previews = {
        registration: {
            subject: "Sikeres regisztráció – képernyőn megjelenő tájékoztató",
            html: "",
            iframeTitle: "Sikeres regisztráció tájékoztató",
            height: 0,
        },
        "registration-confirmation": {
            subject: registrationEmail.subject,
            html: registrationEmail.html,
            iframeTitle: "Regisztráció-megerősítő e-mail",
            height: 850,
        },
        "registration-invite": {
            subject: inviteEmail.subject,
            html: inviteEmail.html,
            iframeTitle: "Regisztrációs meghívó e-mail",
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
        registration: "Ezt a képernyőn megjelenő tájékoztatót a vásárló közvetlenül az adatok sikeres elküldése után látja.",
        "registration-confirmation": "A vásárló a meghívásos regisztráció elküldése után kapja meg, hogy megerősítse e-mail-címét és aktiválja a fiókját.",
        "registration-invite": "Az adminisztrátor ezzel az e-maillel küld egyszer használatos linket a vásárlónak a meghívásos regisztráció megkezdéséhez.",
        "order-created": "A vásárló közvetlenül az új előrendelés leadása után kapja meg, amikor a rendszer sikeresen rögzítette a rendelését.",
        "order-updated": "A vásárló akkor kapja meg, amikor a korábban leadott rendelését módosítja, és a rendszer elmenti a változtatást.",
    };

    return (
        <EmailPreviewSwitcher
            selectedTemplate={selectedTemplate}
            preview={previews[selectedTemplate]}
            useCase={useCases[selectedTemplate]}
            registrationFormPreview={selectedTemplate === "registration" ? <div className="space-y-8"><RegisterForm preview token="admin-preview" email="pelda@domain.hu" /><div className="border-t border-gray-200 pt-8"><p className="mb-3 text-center text-sm font-medium text-gray-500">Sikeres regisztráció utáni visszajelzés</p><RegistrationSuccessMessage /></div></div> : undefined}
        />
    );
}
