import EmailLog from "@/components/admin/EmailLog";

export default function AdminEmailServerPage() {
    return (
        <div className="mx-auto w-full max-w-5xl">
            <h1 className="sr-only">Fiók / E-mail szerver</h1>
            <div className="px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-3xl text-base leading-7 text-gray-600 italic">
                    Az SMTP2GO szolgáltatáson keresztül történik a vásárlók regisztrációs meghívása, e-mail-címük megerősítése és az átvételi emlékeztetők kiküldése. A Resend az új rendelések, rendelésmódosítások és törlések visszaigazolásáért felel. Ezen az oldalon mindkét szolgáltató e-mail-forgalma és a levelek kézbesítési állapota ellenőrizhető.
                </p>
            </div>
            <div className="mt-6">
                <EmailLog />
            </div>
        </div>
    );
}
