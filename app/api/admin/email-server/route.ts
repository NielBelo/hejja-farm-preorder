import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { searchEmailLog } from "@/lib/email/emailLog";
import { decodeCursor, EmailLogError, isEmailLogStatusFilter, isEmailLogType, isEmailProvider } from "@/lib/email/emailLogShared";

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
    const provider = params.get("provider") ?? "";
    const type = params.get("type") ?? "";
    const cursor = decodeCursor(params.get("token") || undefined);
    if (!cursor) return json({ error: "Érvénytelen lapozási kurzor." }, 400);
    try {
        return json(await searchEmailLog({
            recipient: params.get("q")?.trim().slice(0, 200) || undefined,
            status: isEmailLogStatusFilter(status) ? status : undefined,
            type: isEmailLogType(type) ? type : undefined,
            provider: isEmailProvider(provider) ? provider : undefined,
            cursor,
        }));
    } catch (error) {
        if (error instanceof EmailLogError) return json({ error: error.message }, error.status);
        console.error("Email log query failed:", error);
        return json({ error: "Az e-mail napló lekérdezése sikertelen." }, 500);
    }
}
