type Preview = {
    subject: string;
    html: string;
    iframeTitle: string;
    height: number;
    modifiedAt?: string;
    modifiedAtLabel?: string;
};

type TemplateKey = "registration" | "order-created" | "order-updated";

const templateLabels: Record<TemplateKey, string> = {
    registration: "Regisztráció megerősítése",
    "order-created": "Új rendelés visszaigazolása",
    "order-updated": "Rendelés módosítása",
};

export default function EmailPreviewSwitcher({
    selectedTemplate,
    preview,
    useCase,
}: {
    selectedTemplate: TemplateKey;
    preview: Preview;
    useCase: string;
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
                    <iframe
                        title={preview.iframeTitle}
                        srcDoc={preview.html}
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        className="w-full rounded-xl border-0 bg-[#f4f7f5]"
                        style={{ height: preview.height }}
                    />
                </div>
            </div>
        </div>
    );
}
