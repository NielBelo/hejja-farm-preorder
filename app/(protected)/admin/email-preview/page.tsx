import { buildOrderNotification } from "@/lib/email/orderNotification";
import { getLatestOrderUpdate } from "@/lib/email/latestOrderUpdate";
import { getLatestOrderNotificationData } from "@/lib/email/orderNotificationData";
import { buildRegistrationConfirmation } from "@/lib/email/registrationConfirmation";
import { buildRegistrationInvite } from "@/lib/email/registrationInvite";
import RegisterForm, { RegistrationSuccessMessage } from "@/app/(public)/register/RegisterForm";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeasonPickupTimes } from "@/lib/activeSeasonPickupTimes";
import EmailPreviewSwitcher from "./EmailPreviewSwitcher";

// A három megyeág mintaadata a rendelés-e-mailekhez - ugyanabból a
// megye-alapú döntésből (lib/pickupInfo, lib/countyGroups,
// buildOrderNotification-on keresztül) származik, mint éles rendelésnél.
const BEKES_SAMPLE_COUNTY = "Békés";
const NON_BEKES_SAMPLE_COUNTY = "Csongrád-Csanád";
const BACS_KISKUN_SAMPLE_COUNTY = "Bács-Kiskun";
const NO_ACTIVE_SEASON_MESSAGE =
    "Nincs jelenleg aktív szezon beállítva, és nincs elérhető valós rendelés sem mintaadatként, ezért az átvételi időpontot tartalmazó e-mail előnézete nem elérhető. Állítson be aktív szezont a Szezonok oldalon, majd térjen vissza ide.";

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
    const [latestUpdate, activeSeason, latestOrderNotification] = await Promise.all([
        getLatestOrderUpdate(supabase),
        getActiveSeasonPickupTimes(supabase),
        getLatestOrderNotificationData(supabase, { asAdmin: true }),
    ]);

    // A Bács-Kiskun (DUNAVECSE) mintaváltozat a jelenleg aktív szezon valós
    // "vágási napját" mutatja, ha van - lásd az order-confirmation-preview
    // oldal azonos logikáját.
    const { data: activeSeasonRow } = await supabase
        .from("season_parameters")
        .select("id")
        .eq("is_active", true)
        .maybeSingle();
    const { data: dunavecseDay } = activeSeasonRow
        ? await supabase
            .from("pickup_days")
            .select("pickup_date")
            .eq("season_parameter_id", activeSeasonRow.id)
            .eq("kind", "dunavecse")
            .maybeSingle()
        : { data: null };

    const params = await searchParams;
    const rawTemplate = params.template;
    const initialTemplate = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;

    // Valódi módosított rendelés hiányában a legutóbb leadott valós
    // rendelés (getLatestOrderNotificationData) adja a mintaadatot, csak
    // akkor, ha van aktív szezon is - így az átvételi időpont sosem
    // elavult, hardcode-olt érték, hanem vagy egy valódi módosított
    // rendelésé, vagy a jelenleg aktív szezoné.
    const orderDataBase = latestUpdate?.notificationData ?? (
        activeSeason && latestOrderNotification
            ? {
                ...latestOrderNotification.data,
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
    const orderDataBacsKiskun = orderDataBase
        ? {
            ...orderDataBase,
            county: BACS_KISKUN_SAMPLE_COUNTY,
            pickupDate: dunavecseDay?.pickup_date ?? orderDataBase.pickupDate,
        }
        : null;
    const createdOrderEmailBekes = orderDataBekes
        ? buildOrderNotification({ ...orderDataBekes, kind: "created" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const createdOrderEmailVarosi = orderDataVarosi
        ? buildOrderNotification({ ...orderDataVarosi, kind: "created" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const createdOrderEmailBacsKiskun = orderDataBacsKiskun
        ? buildOrderNotification({ ...orderDataBacsKiskun, kind: "created" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const updatedOrderEmailBekes = orderDataBekes
        ? buildOrderNotification({ ...orderDataBekes, kind: "updated" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const updatedOrderEmailVarosi = orderDataVarosi
        ? buildOrderNotification({ ...orderDataVarosi, kind: "updated" }, { logoSrc: "/images/logo2.png", orderUrl })
        : null;
    const updatedOrderEmailBacsKiskun = orderDataBacsKiskun
        ? buildOrderNotification({ ...orderDataBacsKiskun, kind: "updated" }, { logoSrc: "/images/logo2.png", orderUrl })
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
        "order-created": (createdOrderEmailBekes && createdOrderEmailVarosi && createdOrderEmailBacsKiskun) ? {
            subject: createdOrderEmailBekes.subject,
            variants: [
                { label: "Tanyasi átvétel (Békés megyei vásárló)", html: createdOrderEmailBekes.html },
                { label: "Városi átvétel (más megyei vásárló)", html: createdOrderEmailVarosi.html },
                { label: "DUNAVECSE (Bács-Kiskun megyei vásárló)", html: createdOrderEmailBacsKiskun.html },
            ],
            iframeTitle: "Új rendelés visszaigazoló e-mail",
            height: Math.max(760, 560 + (orderDataBase?.items.length ?? 0) * 110),
        } : {
            unavailableMessage: NO_ACTIVE_SEASON_MESSAGE,
        },
        "order-updated": (updatedOrderEmailBekes && updatedOrderEmailVarosi && updatedOrderEmailBacsKiskun) ? {
            subject: updatedOrderEmailBekes.subject,
            variants: [
                { label: "Tanyasi átvétel (Békés megyei vásárló)", html: updatedOrderEmailBekes.html },
                { label: "Városi átvétel (más megyei vásárló)", html: updatedOrderEmailVarosi.html },
                { label: "DUNAVECSE (Bács-Kiskun megyei vásárló)", html: updatedOrderEmailBacsKiskun.html },
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
