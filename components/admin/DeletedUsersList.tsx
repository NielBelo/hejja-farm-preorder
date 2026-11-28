type DeletedUser = {
    id: string;
    full_name: string;
    deleted_at: string;
    deletion_source: string;
};

const sourceLabels: Record<string, string> = { admin: "Admin törölte", self: "Saját törlés" };

function formatDate(value: string) {
    return new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Budapest" }).format(new Date(value));
}

export default function DeletedUsersList({ users }: { users: DeletedUser[] }) {
    return (
        <section className="mt-10 px-4 sm:px-6" aria-labelledby="deleted-users-title">
            <h2 id="deleted-users-title" className="text-lg font-semibold text-gray-900">Törölt felhasználók</h2>
            <p className="mt-1 text-sm text-gray-600">
                Csak a név és a törlés ideje kerül naplózásra, a bejegyzések 3 év után automatikusan törlődnek.
            </p>
            {users.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">Még nincs törölt felhasználó.</p>
            ) : (
                <ul className="mt-3 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
                    {users.map((user) => (
                        <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                            <span className="font-medium text-gray-900">{user.full_name}</span>
                            <span className="text-gray-600">{formatDate(user.deleted_at)} · {sourceLabels[user.deletion_source] ?? user.deletion_source}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
