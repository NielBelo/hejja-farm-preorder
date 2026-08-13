import Header from "@/components/layout/Header";

import Logo from "@/components/layout/Logo";

export default function PublicLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <header className="sticky top-4 z-50 mx-auto w-full max-w-5xl rounded-xl bg-white shadow-sm">
                <div className="flex justify-center px-5 py-3">
                    <Logo />
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6">
                {children}
            </main>
        </>
    );
}