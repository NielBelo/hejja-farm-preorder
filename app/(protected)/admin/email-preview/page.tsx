import { buildOrderNotification } from "@/lib/email/orderNotification";
import { getLatestOrderUpdate } from "@/lib/email/latestOrderUpdate";
import { buildRegistrationConfirmation } from "@/lib/email/registrationConfirmation";
import { buildRegistrationInvite } from "@/lib/email/registrationInvite";
import RegisterForm, { RegistrationSuccessMessage } from "@/app/(public)/register/RegisterForm";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeasonPickupTimes } from "@/lib/activeSeasonPickupTimes";
import EmailPreviewSwitcher from "./EmailPreviewSwitcher";

// A két megyeág mintaadata a rendelés-e-mailekhez - ugyanabból a megye-alapú
// döntésből (lib/pickupInfo, buildOrderNotification-on keresztül) származik,
// mint éles rendelésnél.
const BEKES_SAMPLE_COUNTY = "Békés";
const NON_BEKES_SAMPLE_COUNTY = "Csongrád-Csanád";
const NO_ACTIVE_SEASON_MESSAGE =
    "Nincs jelenleg aktív szezon beállítva, és korábbi rendelésmódosítás sem érhető el mintaadatként, ezért az átvételi időpontot tartalmazó e-mail előnézete nem elérhető. Állítson be aktív szezont a Szezonok oldalon, majd térjen vissza ide.";

// A rendelésszám, tételek stb. csak a fejlesztői előnézethez kellenek. Az
// átvételi IDŐPONT mezőket (pickupTimeStart/pickupTimeEnd/
// localPickupTimeStart) nem itt hardcode-oljuk, azokat lent a jelenleg
// aktív szezon season_parameters beállításaiból töltjük fel, hogy ne
// mutasson elavult mintaidőpontot.
const sampleOrderDataBase = {
    kind: "created" as const,
    orderId: 0,
    orderNumber: "HF-MINTA01",
    customerName: "Dániel",
    pickupDate: "2026-09-19",
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
    const [latestUpdate, activeSeason] = await Promise.all([
        getLatestOrderUpdate(supabase),
        getActiveSeasonPickupTimes(supabase),
    ]);
    const params = await searchParams;
    const rawTemplate = params.template;
    const initialTemplate = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;

    // Valódi módosított rendelés hiányában csak akkor van mintaadat, ha
    // van aktív szezon - így az átvételi időpont sosem elavult, hardcode-olt
    // érték, hanem vagy egy valódi rendelésé, vagy a jelenleg aktív szezoné.
    const orderDataBase = latestUpdate?.notificationData ?? (
        activeSeason
            ? {
                ...sampleOrderDataBase,
                pickupTimeStart: activeSeason.pickupTimeStart,
                pickupTimeEnd: activeSeason.pickupTimeEnd,
                localPickupTimeStart: activeSeason.localPickupTimeStart,
            }
            : null
    );

    const orderUrl = orderDataBase?.orderId
        ? `/history?focusOrder=${orderDataBase.orderId}#order-${orderDataBase.orderId}`
        : "/history";
    const orderDataBekes = orderDataBase ? { ...orderDataBase, county: BEKES_SAMPLE_COUNTY } : null;
    const orderDataVarosi = orderDataBase ? { ...orderDataBase, county: NON_BEKES_SAMPLE_COUNTY } : null;
    const createdOrderEmailBekes = orderDataBekes
        ? buildOrderNotification({ ...orderDataBekes, kind: "created" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const createdOrderEmailVarosi = orderDataVarosi
        ? buildOrderNotification({ ...orderDataVarosi, kind: "created" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const updatedOrderEmailBekes = orderDataBekes
        ? buildOrderNotification({ ...orderDataBekes, kind: "updated" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const updatedOrderEmailVarosi = orderDataVarosi
        ? buildOrderNotification({ ...orderDataVarosi, kind: "updated" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
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
        "order-created": (createdOrderEmailBekes && createdOrderEmailVarosi) ? {
            subject: createdOrderEmailBekes.subject,
            variants: [
                { label: "Tanyasi átvétel (Békés megyei vásárló)", html: createdOrderEmailBekes.html },
                { label: "Városi átvétel (más megyei vásárló)", html: createdOrderEmailVarosi.html },
            ],
            iframeTitle: "Új rendelés visszaigazoló e-mail",
            height: Math.max(760, 560 + (orderDataBase?.items.length ?? 0) * 110),
        } : {
            unavailableMessage: NO_ACTIVE_SEASON_MESSAGE,
        },
        "order-updated": (updatedOrderEmailBekes && updatedOrderEmailVarosi) ? {
            subject: updatedOrderEmailBekes.subject,
            variants: [
                { label: "Tanyasi átvétel (Békés megyei vásárló)", html: updatedOrderEmailBekes.html },
                { label: "Városi átvétel (más megyei vásárló)", html: updatedOrderEmailVarosi.html },
            ],
            iframeTitle: "Rendelésmódosító e-mail",
            modifiedAt: latestUpdate?.modifiedAt,
            modifiedAtLabel: latestUpdate ? formatDateTime(latestUpdate.modifiedAt) : undefined,
            height: Math.max(760, 560 + (orderDataBase?.items.length ?? 0) * 110),
        } : {
            unavailableMessage: NO_ACTIVE_SEASON_MESSAGE,
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
