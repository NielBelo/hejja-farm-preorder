export const metadata = {
    title: "Szezonindítási értesítő",
};

export default function AdminSeasonLaunchNotificationPage() {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="px-4 text-center sm:px-6">
                <div className="mt-2.5 flex items-center gap-4">
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                    <h1 className="shrink-0 text-md font-semibold tracking-wider text-gray-500">
                        Szezonindítási értesítő
                    </h1>
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                </div>
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    A szezonindítási értesítő az új előrendelési időszak kezdetéről tájékoztatja a vásárlókat.
                </p>
            </div>
        </div>
    );
}
