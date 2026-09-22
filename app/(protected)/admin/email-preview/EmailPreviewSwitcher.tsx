type PreviewVariant = {
    label: string;
    html: string;
};

type Preview = {
    subject?: string;
    html?: string;
    variants?: PreviewVariant[];
    iframeTitle?: string;
    height?: number;
    modifiedAt?: string;
    modifiedAtLabel?: string;
    /** Ha nincs elérhető mintaadat (nincs aktív szezon és korábbi rendelés sem), a többi mező helyett ez jelenik meg. */
    unavailableMessage?: string;
};

type TemplateKey = "registration" | "registration-confirmation" | "registration-invite" | "order-created" | "order-updated" | "order-cancelled";

const templateLabels: Record<TemplateKey, string> = {
    registration: "Regisztráció",
    "registration-confirmation": "Regisztráció megerősítése",
    "registration-invite": "Regisztrációs meghívó",
    "order-created": "Új rendelés visszaigazolása",
    "order-updated": "Rendelés módosítása",
    "order-cancelled": "Rendelés törlése",
};

export default function EmailPreviewSwitcher({
    selectedTemplate,
    preview,
    useCase,
    registrationFormPreview,
}: {
    selectedTemplate: TemplateKey;
    preview: Preview;
    useCase: string;
    registrationFormPreview?: ReactNode;
}) {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="px-4 text-center sm:px-6">
                <div className="mt-2.5 flex items-center gap-4">
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                    <h1 className="shrink-0 text-md font-semibold tracking-wider text-gray-500">
                        {templateLabels[selectedTemplate]}
                    </h1>
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                </div>
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    <span className="block">{useCase}</span>
                </p>
            </div>

            {preview.unavailableMessage ? (
                <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-700">
                    {preview.unavailableMessage}
                </p>
            ) : (
                <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
                        <dl className="grid gap-3 text-sm">
                            <div className="grid grid-cols-[5rem_1fr] gap-3">
                                <dt className="font-medium text-gray-500">Tárgy</dt>
                                <dd className="font-medium text-gray-900">{preview.subject}</dd>
                            </div>
                            {preview.modifiedAt && preview.modifiedAtLabel ? (
                                <div className="grid grid-cols-[5rem_1fr] gap-3">
                                    <dt className="font-medium text-gray-500">Módosítva</dt>
                                    <dd className="text-gray-700">
                                        <time dateTime={preview.modifiedAt}>{preview.modifiedAtLabel}</time>
                                    </dd>
                                </div>
                            ) : null}
                        </dl>
                    </div>

                    <div className="bg-[#f4f7f5] p-3 sm:p-6">
                        {registrationFormPreview ? (
                            <div className="mx-auto max-w-2xl rounded-xl bg-white p-6 shadow-sm sm:p-8">
                                <h2 className="mb-6 text-center text-2xl font-bold text-gray-700">Regisztráció</h2>
                                {registrationFormPreview}
                            </div>
                        ) : preview.variants ? (
                            <div className="space-y-6">
                                {preview.variants.map((variant) => (
                                    <div key={variant.label}>
                                        <p className="mb-2 text-center text-sm font-semibold text-gray-600">
                                            {variant.label}
                                        </p>
                                        <iframe
                                            title={`${preview.iframeTitle} – ${variant.label}`}
                                            srcDoc={variant.html}
                                            sandbox="allow-popups allow-popups-to-escape-sandbox"
                                            className="w-full rounded-xl border-0 bg-[#f4f7f5]"
                                            style={{ height: preview.height }}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : <iframe
                            title={preview.iframeTitle}
                            srcDoc={preview.html}
                            sandbox="allow-popups allow-popups-to-escape-sandbox"
                            className="w-full rounded-xl border-0 bg-[#f4f7f5]"
                            style={{ height: preview.height }}
                        />}
                    </div>
                </div>
            )}
        </div>
    );
}
import type { ReactNode } from "react";
