"use client";

import { useState } from "react";
import { PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { sendRegistrationInvites, type InviteBatchResult } from "@/app/(protected)/admin/accounts/invites/actions";

export default function InviteSender() {
    const [emails, setEmails] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [result, setResult] = useState<InviteBatchResult | null>(null);
    return <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <h1 className="text-xl font-semibold text-gray-800">Meghívók kiküldése</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Soronként egy címzettet adjon meg <strong>e-mail-cím; keresztnév</strong> formában. A keresztnév opcionális, de megadásával személyes megszólítást kap a címzett.</p>
        <form className="mt-5" onSubmit={async (event) => {
            event.preventDefault();
            if (isSending) return;
            setIsSending(true); setResult(null);
            try {
                const nextResult = await sendRegistrationInvites(emails);
                setResult(nextResult);
                if (nextResult.sent.length) setEmails("");
            } finally { setIsSending(false); }
        }}>
            <label className="block text-sm font-medium text-gray-700">Címzettek
                <textarea value={emails} onChange={(event) => setEmails(event.target.value)} required rows={8} maxLength={26000} placeholder={'daniel@pelda.hu; Dániel\nagnes@pelda.hu; Ágnes'} className="mt-1.5 block w-full rounded-lg border border-gray-300 px-3 py-2.5 font-mono text-sm text-gray-800 outline-none focus:border-[rgb(49,171,2)] focus:ring-2 focus:ring-[rgb(49,171,2)]/10" />
            </label>
            {result?.error && <p role="alert" className="mt-3 text-sm text-red-600">{result.error}</p>}
            {result && (result.sent.length > 0 || result.failed.length > 0) && <div className="mt-4 space-y-3" role="status">
                {result.sent.length > 0 && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"><strong>{result.sent.length} meghívó elküldve.</strong> {result.sent.join(", ")}</p>}
                {result.failed.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><strong>{result.failed.length} küldés sikertelen:</strong><ul className="mt-1 list-disc pl-5">{result.failed.map(({ email, error }) => <li key={email}>{email}: {error}</li>)}</ul></div>}
            </div>}
            <div className="mt-5 flex justify-end border-t border-gray-100 pt-4"><button type="submit" disabled={isSending} className="inline-flex items-center gap-2 rounded-lg bg-[rgb(49,171,2)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-300"><PaperAirplaneIcon aria-hidden="true" className="h-4 w-4" />{isSending ? "Küldés…" : "Meghívók küldése"}</button></div>
        </form>
    </section>;
}
