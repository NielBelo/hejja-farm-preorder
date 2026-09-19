"use client";
import { useEffect, useState } from "react";
import { CalendarDaysIcon, CheckCircleIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { deleteSeason, saveSeason, type SeasonInput } from "@/app/(protected)/admin/seasons/actions";

type Season = SeasonInput & { id: string; created_at: string };

const blank = (): SeasonInput => ({
  year: new Date().getFullYear(),
  type: "Tavasz",
  price: 0,
  weightMin: 2,
  weightMax: 3,
  orderStart: "",
  orderEnd: "",
  pickupTimeStart: "",
  pickupTimeEnd: "",
  localPickupTimeStart: "",
  pickupDays: [{ date: "", limit: 1 }],
  active: false,
});

const getYearOptions = () => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => currentYear - 1 + i);
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("hu-HU", { dateStyle: "long", timeZone: "Europe/Budapest" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`)
  );

const inputClass =
  "mt-2 w-full rounded-xl border-2 border-[rgba(7,109,143,0.2)] bg-white px-4 py-2.5 text-gray-700 outline-none transition focus:border-[rgb(49,171,2)]";
const labelClass = "block text-sm font-medium text-gray-700";

function NumberField({
  value,
  onChange,
  decimal = false,
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  decimal?: boolean;
  min?: number;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => setText(String(value)), [value]);

  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(decimal ? /[^0-9.,]/g : /\D/g, "");
        setText(raw);
        const n = Number(raw.replace(",", "."));
        if (raw !== "" && Number.isFinite(n) && n >= min) onChange(n);
      }}
      onBlur={() => {
        const n = Number(text.replace(",", "."));
        if (!Number.isFinite(n) || n < min) setText(String(value));
        else {
          onChange(n);
          setText(String(n));
        }
      }}
      className={inputClass}
    />
  );
}

function Editor({
  value,
  onChange,
  onSave,
  saving,
}: {
  value: SeasonInput;
  onChange: (v: SeasonInput) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const days = (fn: (d: SeasonInput["pickupDays"][number], i: number) => SeasonInput["pickupDays"][number]) =>
    onChange({ ...value, pickupDays: value.pickupDays.map(fn) });

  // Egy meglévő szezon éve elméletileg kívül eshet az alapértelmezett
  // tartományon (pl. régebbi szezon szerkesztésekor); ilyenkor a jelenlegi
  // értéket is felvesszük a listába, hogy a mentés ne cserélje le észrevétlenül.
  const yearOptions = Array.from(new Set([...getYearOptions(), value.year])).sort((a, b) => a - b);

  return (
    <form
      className="mt-6 grid gap-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label>
        <span className={labelClass}>Év</span>
        <select
          value={value.year}
          onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
          className={inputClass}
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className={labelClass}>Szezon</span>
        <select
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as SeasonInput["type"] })}
          className={inputClass}
        >
          <option>Tavasz</option>
          <option>Ősz</option>
        </select>
      </label>

      <label>
        <span className={labelClass}>Kg-os ár (Ft)</span>
        <NumberField value={value.price} onChange={(v) => onChange({ ...value, price: v })} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={labelClass}>Min. súly (kg)</span>
          <NumberField decimal min={0.1} value={value.weightMin} onChange={(v) => onChange({ ...value, weightMin: v })} />
        </label>
        <label>
          <span className={labelClass}>Max. súly (kg)</span>
          <NumberField decimal min={0.1} value={value.weightMax} onChange={(v) => onChange({ ...value, weightMax: v })} />
        </label>
      </div>

      <label>
        <span className={labelClass}>Előrendelés kezdete</span>
        <input
          type="date"
          value={value.orderStart}
          onChange={(e) => onChange({ ...value, orderStart: e.target.value })}
          className={inputClass}
        />
      </label>

      <label>
        <span className={labelClass}>Előrendelés vége</span>
        <input
          type="date"
          value={value.orderEnd}
          onChange={(e) => onChange({ ...value, orderEnd: e.target.value })}
          className={inputClass}
        />
      </label>

      <label>
        <span className={labelClass}>Átvétel kezdete</span>
        <input
          type="time"
          value={value.pickupTimeStart}
          onChange={(e) => onChange({ ...value, pickupTimeStart: e.target.value })}
          className={inputClass}
        />
      </label>

      <label>
        <span className={labelClass}>Átvétel vége</span>
        <input
          type="time"
          value={value.pickupTimeEnd}
          onChange={(e) => onChange({ ...value, pickupTimeEnd: e.target.value })}
          className={inputClass}
        />
      </label>

      <label>
        <span className={labelClass}>Helyi (tanyasi) átvétel kezdete</span>
        <input
          type="time"
          value={value.localPickupTimeStart}
          onChange={(e) => onChange({ ...value, localPickupTimeStart: e.target.value })}
          className={inputClass}
        />
      </label>

      <div className="space-y-3 sm:col-span-2">
        <p className={labelClass}>Átvételi napok</p>

        {value.pickupDays.map((d, i) => (
          <div
            key={i}
            className="flex items-end gap-3 rounded-xl border border-[rgba(92,113,190,0.35)] bg-[rgba(92,113,190,0.07)] p-3"
          >
            <label className="flex-1">
              <span className="block text-xs font-medium text-[rgb(55,75,150)]">Dátum</span>
              <input
                type="date"
                value={d.date}
                onChange={(e) => days((x, j) => (j === i ? { ...x, date: e.target.value } : x))}
                className={`${inputClass} mt-1`}
              />
            </label>

            <label className="w-28">
              <span className="block text-xs font-medium text-[rgb(55,75,150)]">Napi limit</span>
              <div className="mt-1">
                <NumberField min={1} value={d.limit} onChange={(v) => days((x, j) => (j === i ? { ...x, limit: v } : x))} />
              </div>
            </label>

            <button
              type="button"
              onClick={() => onChange({ ...value, pickupDays: value.pickupDays.filter((_, j) => j !== i) })}
              disabled={value.pickupDays.length === 1}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-400 transition hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Átvételi nap törlése"
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        ))}

        {value.pickupDays.length < 5 && (
          <button
            type="button"
            onClick={() => onChange({ ...value, pickupDays: [...value.pickupDays, { date: "", limit: 1 }] })}
            className="flex items-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-500 transition hover:border-[rgb(49,171,2)] hover:text-[rgb(49,171,2)]"
          >
            <PlusIcon className="h-4 w-4" />
            Átvételi nap hozzáadása
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => onChange({ ...value, active: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]"
        />
        <span className="text-sm font-medium text-gray-700">Szezon aktiválása</span>
      </label>

      <button
        disabled={saving}
        className="rounded-xl bg-[rgb(49,171,2)] px-4 py-2.5 font-medium text-white transition hover:brightness-95 disabled:opacity-60 sm:col-span-2"
      >
        {saving ? "Mentés…" : "Mentés"}
      </button>
    </form>
  );
}

export default function SeasonManager({ seasons }: { seasons: Season[] }) {
  const [form, setForm] = useState(blank());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await saveSeason(form);
    if (r.success) {
      setOpen(false);
      setEditing(null);
      setForm(blank());
    } else setError(r.error);
    setSaving(false);
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    const r = await deleteSeason(id);
    if (r.success) {
      setConfirmDeleteId(null);
      if (editing === id) {
        setEditing(null);
        setForm(blank());
      }
    } else setDeleteError(r.error);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 text-left">
          <PlusIcon className="h-5 w-5 text-[rgb(49,171,2)]" />
          <span className="flex-1 font-semibold text-gray-800">Új szezon</span>
          <span className="text-gray-400">{open ? "−" : "+"}</span>
        </button>

        {open && !editing && <Editor value={form} onChange={setForm} onSave={save} saving={saving} />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-800">Korábbi és aktuális szezonok</h2>

        <div className="grid gap-4">
          {seasons.map((s) => (
            <article
              key={s.id}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${
                s.active ? "border-[rgb(49,171,2)]/40 ring-1 ring-[rgb(49,171,2)]/20" : "border-gray-100"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-gray-800">
                  <CalendarDaysIcon className="h-5 w-5 text-gray-400" />
                  {s.year} {s.type}
                </h3>

                <div className="flex items-center gap-2">
                  {s.active && (
                    <span className="flex items-center gap-1 rounded-full bg-[rgb(49,171,2)]/10 px-2.5 py-1 text-xs font-medium text-[rgb(49,171,2)]">
                      <CheckCircleIcon className="h-4 w-4" />
                      Aktív
                    </span>
                  )}

                  {editing !== s.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmDeleteId(s.id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                      aria-label="Szezon törlése"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {confirmDeleteId === s.id && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-700">
                    Biztosan törli ezt a szezont az összes átvételi napjával együtt? Ez a művelet nem vonható vissza.
                  </p>
                  {deleteError && <p className="mt-2 text-sm font-medium text-red-700">{deleteError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={deletingId === s.id}
                      onClick={() => remove(s.id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                    >
                      {deletingId === s.id ? "Törlés…" : "Törlés megerősítése"}
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === s.id}
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                    >
                      Mégse
                    </button>
                  </div>
                </div>
              )}

              {editing === s.id ? (
                <Editor value={form} onChange={setForm} onSave={save} saving={saving} />
              ) : (
                <>
                  <p className="mt-3 text-gray-600">
                    <span className="font-medium text-gray-800">{s.price} Ft/kg</span> · {s.weightMin}–{s.weightMax} kg
                  </p>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {s.pickupDays.map((d) => (
                      <div
                        key={d.date}
                        className="rounded-xl border border-[rgba(92,113,190,0.35)] bg-[rgba(92,113,190,0.07)] p-3"
                      >
                        <p className="font-medium text-[rgb(55,75,150)]">{formatDate(d.date)}</p>
                        <p className="text-sm text-gray-600">Napi limit: {d.limit} db</p>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="mt-4 text-sm font-medium text-[rgb(49,171,2)] hover:underline"
                    onClick={() => {
                      setForm({ ...s, pickupDays: s.pickupDays.map((d) => ({ ...d })) });
                      setEditing(s.id);
                      setOpen(false);
                      setConfirmDeleteId(null);
                    }}
                  >
                    Szerkesztés / aktiválás
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
