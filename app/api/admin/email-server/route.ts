import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { EmailLogError, isEmailLogStatusFilter, searchEmailLog } from "@/lib/email/smtp2goActivity";

const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: privateHeaders });
}

export async function GET(request: NextRequest) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return json({ error: "A munkamenet lejárt. Jelentkezzen be újra." }, 401);
    if (!currentUser.isAdmin) return json({ error: "Ehhez a művelethez adminisztrátori jogosultság szükséges." }, 403);

    const params = request.nextUrl.searchParams;
    const status = params.get("status") ?? "";
    try {
        return json(await searchEmailLog({
            recipient: params.get("q")?.trim().slice(0, 200) || undefined,
            status: isEmailLogStatusFilter(status) ? status : undefined,
            token: params.get("token") || undefined,
        }));
    } catch (error) {
        if (error instanceof EmailLogError) return json({ error: error.message }, error.status);
        console.error("Email log query failed:", error);
        return json({ error: "Az e-mail napló lekérdezése sikertelen." }, 500);
    }
}
