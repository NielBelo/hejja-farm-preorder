"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { deleteSeason, saveSeason, setDunavecsePickupDayActive, type SeasonInput } from "@/app/(protected)/admin/seasons/actions";

// A DUNAVECSE (Bács-Kiskun) technikai nap - a normál pickupDays listától
// külön, mert nem szerkeszthető/törölhető a form-on keresztül, csak
// aktiválható/deaktiválható. Korlátlan kapacitású, ezért nincs limit/
// reservedQuantity mezője.
type DunavecseInfo = {
  id: number;
  date: string;
  active: boolean;
  orderCount: number;
  hasOrderHistory: boolean;
};

type Season = SeasonInput & { id: string; created_at: string; dunavecse: DunavecseInfo | null };

const blank = (): SeasonInput => ({
  year: new Date().getFullYear(),
  type: "Tavasz",
  price: 0,
  weightMin: 2,
  weightMax: 3,
  orderStart: "",
  orderEnd: "",
  pickupTimeStart: "17:00",
  pickupTimeEnd: "18:00",
  localPickupTimeStart: "17:00",
  pickupDays: [{ date: "", limit: 1, active: true }],
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
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-800 outline-none transition focus:border-blue-400 focus:outline-blue-400";
const labelClass = "block text-sm font-medium text-gray-600";
// Az aktív/inaktív jelzés zöld/szürke marad (üzleti állapot); a kék
// kiemelés kizárólag a kártya keretén jelenik meg, amikor az adott
// szezon éppen nyitva van vagy szerkesztés alatt áll - ugyanaz a kék,
// mint az Előzmények oldal kártya-kiemelése (EditableOrderCard.tsx).
const statusBadgeClass = (active: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm transition ${
    active ? "border-green-200 bg-green-50 text-green-700" : "border-gray-300 bg-gray-100 text-gray-500"
  }`;
const cardHighlightClass = (highlighted: boolean) =>
  `rounded-xl bg-white p-4 transition-all ${
    highlighted
      ? "border-2 border-[rgb(92,113,190)] shadow-lg ring-2 ring-[rgba(92,113,190,0.18)]"
      : "border border-gray-200 shadow-sm"
  }`;

function StatusBadge({ active }: { active: boolean }) {
  const Icon = active ? CheckCircleIcon : XCircleIcon;
  return (
    <span className={statusBadgeClass(active)}>
      <Icon className="h-4 w-4" />
      {active ? "Aktív" : "Inaktív"}
    </span>
  );
}

// Elegáns, bepipálható négyzet az átvételi nap aktiválásához/inaktiválásához -
// a kijelölt állapotot a felirat és a háttérszín is jelzi, nem csak a pipa.
function ActiveCheckbox({
  active,
  disabled,
  loading,
  onChange,
}: {
  active: boolean;
  disabled?: boolean;
  loading?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
        active ? "border-green-200 bg-green-50 text-green-700" : "border-gray-300 bg-gray-100 text-gray-500"
      } ${disabled || loading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={active}
        disabled={disabled || loading}
        onChange={onChange}
        className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]"
      />
      {loading ? "…" : active ? "Aktív" : "Inaktív"}
    </label>
  );
}

// Kattintásra megjelenő, kattintással rejtett rövid magyarázat egy mező
// vagy szakasz mellett, hogy a tartósan látható szöveg ne foglaljon
// helyet, amíg az admin nem kér róla részletet.
function InfoTip({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-expanded={isOpen}
        aria-label="Részletek megjelenítése"
        className="flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition hover:text-gray-600"
      >
        <InformationCircleIcon className="h-4 w-4" />
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-64 space-y-1.5 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal leading-relaxed text-gray-600 shadow-lg">
          {children}
        </div>
      )}
    </span>
  );
}

function StatChip({ value, label }: { value: string | number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
      <span className="font-semibold text-gray-800">{value}</span>
      {label}
    </span>
  );
}

function OrderStatsCard({ orderCount, reservedQuantity }: { orderCount: number; reservedQuantity: number }) {
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm"
      title="Ehhez az átvételi naphoz tartozott rendelés, ezért a rendelési előzmény megőrzése miatt nem törölhető. Deaktiválja törlés helyett."
    >
      <span className="font-semibold text-gray-800">{orderCount}</span>
      <span>aktív rendelés</span>
      <span className="text-gray-300">·</span>
      <span className="font-semibold text-gray-800">{reservedQuantity}</span>
      <span>db csirke</span>
    </div>
  );
}

// Natív <select> helyett - a böngésző saját legördülő listája nem
// stílusozható (apró betűméret, a design egyik eleméhez sem illeszkedik),
// ezért ugyanazt a listbox-mintát használjuk, mint az admin fiókszerkesztő
// vármegye-választója (AdminAccountEditor.tsx CountySelect).
function Listbox({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && <span className={labelClass}>{label}</span>}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`${label ? "mt-1 " : ""}flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-left text-base text-gray-800 outline-none transition ${
          isOpen ? "border-[rgb(49,171,2)] ring-2 ring-[rgb(49,171,2)]/10" : "border-gray-300"
        }`}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div role="listbox" className="max-h-64 overflow-y-auto p-1.5">
            {options.map((o) => {
              const isSelected = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-base text-gray-800 transition-colors hover:bg-[#F0FAEE] ${
                    isSelected ? "bg-[#F0FAEE] font-medium" : "bg-white"
                  }`}
                >
                  <span>{o.label}</span>
                  {isSelected && <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(49,171,2)]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const BASE_MINUTES = ["00", "15", "30", "45"];

function TimeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [h, m] = (value || "17:00").split(":");
  const minutes = Array.from(new Set([...BASE_MINUTES, m])).sort();
  const hourOptions = HOURS.map((hh) => ({ value: hh, label: hh }));
  const minuteOptions = minutes.map((mm) => ({ value: mm, label: mm }));
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <Listbox value={h} options={hourOptions} onChange={(v) => onChange(`${v}:${m}`)} className="w-24" />
      <span className="text-gray-400">:</span>
      <Listbox value={m} options={minuteOptions} onChange={(v) => onChange(`${h}:${v}`)} className="w-24" />
    </div>
  );
}

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
  onCancel,
  saving,
  error,
}: {
  value: SeasonInput;
  onChange: (v: SeasonInput) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error?: string | null;
}) {
  const days = (fn: (d: SeasonInput["pickupDays"][number], i: number) => SeasonInput["pickupDays"][number]) =>
    onChange({ ...value, pickupDays: value.pickupDays.map(fn) });

  // Egy meglévő szezon éve elméletileg kívül eshet az alapértelmezett
  // tartományon (pl. régebbi szezon szerkesztésekor); ilyenkor a jelenlegi
  // értéket is felvesszük a listába, hogy a mentés ne cserélje le észrevétlenül.
  const yearOptions = Array.from(new Set([...getYearOptions(), value.year])).sort((a, b) => a - b);

  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <Listbox
        label="Év"
        value={String(value.year)}
        options={yearOptions.map((year) => ({ value: String(year), label: String(year) }))}
        onChange={(v) => onChange({ ...value, year: Number(v) })}
      />

      <Listbox
        label="Szezon"
        value={value.type}
        options={[
          { value: "Tavasz", label: "Tavasz" },
          { value: "Ősz", label: "Ősz" },
        ]}
        onChange={(v) => onChange({ ...value, type: v as SeasonInput["type"] })}
      />

      <label>
        <span className={labelClass}>Kg-os ár (Ft)</span>
        <NumberField value={value.price} onChange={(v) => onChange({ ...value, price: v })} />
      </label>

      <div className="grid grid-cols-2 gap-2">
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

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 sm:col-span-2">
        <p className="text-xs font-semibold text-gray-600">Átvételi időpontok</p>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <span className={`${labelClass} inline-flex items-center gap-1`}>
              Városi átvétel kezdete
              <InfoTip>Minden átvételi napra vonatkozik. A Békés és Bács-Kiskun megyei vásárlók kivételével.</InfoTip>
            </span>
            <TimeSelect value={value.pickupTimeStart} onChange={(v) => onChange({ ...value, pickupTimeStart: v })} />
          </div>
          <div>
            <span className={`${labelClass} inline-flex items-center gap-1`}>
              Városi átvétel vége
              <InfoTip>Minden átvételi napra vonatkozik. A Békés és Bács-Kiskun megyei vásárlók kivételével.</InfoTip>
            </span>
            <TimeSelect value={value.pickupTimeEnd} onChange={(v) => onChange({ ...value, pickupTimeEnd: v })} />
          </div>
        </div>

        <div className="mt-3 border-t border-gray-200 pt-3">
          <span className={`${labelClass} inline-flex items-center gap-1`}>
            Tanyasi átvétel kezdete
            <InfoTip>Minden átvételi napra vonatkozik, kizárólag a Békés megyei vásárlók számára.</InfoTip>
          </span>
          <TimeSelect value={value.localPickupTimeStart} onChange={(v) => onChange({ ...value, localPickupTimeStart: v })} />
        </div>
      </div>

      <div className="space-y-2 sm:col-span-2">
        <div className={`${labelClass} inline-flex items-center gap-1`}>
          Átvételi napok
          <InfoTip>
            <p>
              Átvételi nap csak akkor törölhető, ha ahhoz sem aktív, sem lemondott rendelés nem tartozik. Ha már
              tartozik hozzá rendelés, az átvételi nap nem törölhető, csak inaktiválható. A korábban leadott
              rendelések ettől nem vesznek el.
            </p>
            {value.active && (
              <p className="mt-1.5">
                Inaktív átvételi napra új rendelés nem adható le, a meglévő rendelések pedig nem módosíthatók. A
                korábban leadott rendelések továbbra is megmaradnak.
              </p>
            )}
          </InfoTip>
        </div>

        {value.pickupDays.map((d, i) => {
          const dayActive = d.active !== false;
          return (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
              <label className="min-w-[10rem] flex-1">
                <span className={labelClass}>Dátum</span>
                <input
                  type="date"
                  value={d.date}
                  onChange={(e) => days((x, j) => (j === i ? { ...x, date: e.target.value } : x))}
                  className={inputClass}
                />
              </label>

              <label className="w-24">
                <span className={labelClass}>Napi limit</span>
                <NumberField min={1} value={d.limit} onChange={(v) => days((x, j) => (j === i ? { ...x, limit: v } : x))} />
              </label>

              {value.active && (
                <ActiveCheckbox
                  active={dayActive}
                  onChange={() => days((x, j) => (j === i ? { ...x, active: !dayActive } : x))}
                />
              )}

              {d.hasOrderHistory ? (
                <OrderStatsCard orderCount={d.orderCount ?? 0} reservedQuantity={d.reservedQuantity ?? 0} />
              ) : (
                <button
                  type="button"
                  onClick={() => onChange({ ...value, pickupDays: value.pickupDays.filter((_, j) => j !== i) })}
                  disabled={value.pickupDays.length === 1}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Átvételi nap törlése"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}

        {value.pickupDays.length < 5 && (
          <button
            type="button"
            onClick={() => onChange({ ...value, pickupDays: [...value.pickupDays, { date: "", limit: 1, active: true }] })}
            className="flex items-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition hover:border-[rgb(49,171,2)] hover:text-[rgb(49,171,2)]"
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

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 sm:col-span-2">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mégse
        </button>
        <button
          disabled={saving}
          className="rounded-lg bg-[rgb(49,171,2)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          {saving ? "Mentés…" : "Mentés"}
        </button>
      </div>
    </form>
  );
}

export default function SeasonManager({ seasons }: { seasons: Season[] }) {
  const [form, setForm] = useState(blank());
  const [open, setOpen] = useState(false);
  // expandedId: melyik szezon kártyája van lenyitva (egyszerre csak egy).
  // editingId: az adott (lenyitott) kártya éppen szerkesztő nézetben van-e -
  // szerkesztés csak a lenyitott, részletes nézetből indítható.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dunavecseTogglingId, setDunavecseTogglingId] = useState<number | null>(null);
  const [dunavecseError, setDunavecseError] = useState<string | null>(null);

  const toggleDunavecseActive = async (dunavecse: DunavecseInfo) => {
    setDunavecseTogglingId(dunavecse.id);
    setDunavecseError(null);
    const r = await setDunavecsePickupDayActive(dunavecse.id, !dunavecse.active);
    if (!r.success) setDunavecseError(r.error);
    setDunavecseTogglingId(null);
  };

  const closeEditor = () => {
    setOpen(false);
    setExpandedId(null);
    setEditingId(null);
    setForm(blank());
    setError(null);
  };

  const cancelSeasonEdit = () => {
    setEditingId(null);
    setForm(blank());
    setError(null);
  };

  const toggleExpand = (id: string) => {
    setOpen(false);
    setConfirmDeleteId(null);
    setError(null);
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
      setForm(blank());
    } else {
      setExpandedId(id);
      setEditingId(null);
      setForm(blank());
    }
  };

  const startEditingSeason = (s: Season) => {
    // Régebbi, a felület bevezetése előtt létrehozott szezonoknál ezek a
    // mezők üresek lehetnek az adatbázisban. A TimeSelect ilyenkor is mutat
    // egy alapértelmezett órát/percet, hogy ne legyen üres választható elem -
    // de ha ezt nem szinkronizálnánk vissza a form állapotába, a mentés az
    // űrlapon látszólag már kitöltött mezőket is üresként utasítaná el.
    setForm({
      ...s,
      pickupTimeStart: s.pickupTimeStart || "17:00",
      pickupTimeEnd: s.pickupTimeEnd || "18:00",
      localPickupTimeStart: s.localPickupTimeStart || "17:00",
      pickupDays: s.pickupDays.map((d) => ({ ...d })),
    });
    setEditingId(s.id);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await saveSeason(form);
      if (r.success) closeEditor();
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "A szezon mentése váratlan hiba miatt sikertelen.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    const r = await deleteSeason(id);
    if (r.success) {
      setConfirmDeleteId(null);
      if (expandedId === id) {
        setExpandedId(null);
        setEditingId(null);
        setForm(blank());
      }
    } else setDeleteError(r.error);
    setDeletingId(null);
  };

  return (
    <div className="space-y-4">
      <section className={cardHighlightClass(open)}>
        <button
          type="button"
          onClick={() => (open ? closeEditor() : (setForm(blank()), setExpandedId(null), setEditingId(null), setOpen(true)))}
          className="flex w-full items-center gap-3 text-left"
        >
          <PlusIcon className="h-5 w-5 text-[rgb(49,171,2)]" />
          <span className="flex-1 font-semibold text-gray-800">Új szezon</span>
          <span className="text-gray-400">{open ? "−" : "+"}</span>
        </button>

        {open && <Editor value={form} onChange={setForm} onSave={save} onCancel={closeEditor} saving={saving} error={error} />}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-800">Korábbi és aktuális szezonok</h2>

        <div className="grid gap-3">
          {seasons.map((s) => {
            const expanded = expandedId === s.id;
            const isEditing = editingId === s.id;
            const activeDaysCount = s.pickupDays.filter((d) => d.active !== false).length;
            const totalOrders = s.pickupDays.reduce((sum, d) => sum + (d.orderCount ?? 0), 0);
            const totalReserved = s.pickupDays.reduce((sum, d) => sum + (d.reservedQuantity ?? 0), 0);
            // A törlés a rendelési előzmény megőrzése miatt bármilyen (akár
            // lemondott) rendelést figyelembe vesz, nem csak az aktív
            // (submitted) foglalásokat tükröző totalOrders statisztikát - ez
            // a DUNAVECSE napra is vonatkozik, hiszen a szezon törlése a
            // hozzá tartozó DUNAVECSE napot is törölné.
            const canDelete = !s.pickupDays.some((d) => d.hasOrderHistory) && !s.dunavecse?.hasOrderHistory;

            return (
              <article key={s.id} className={cardHighlightClass(expanded)}>
                <h3>
                  <button
                    type="button"
                    onClick={() => toggleExpand(s.id)}
                    aria-expanded={expanded}
                    aria-controls={`season-${s.id}`}
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  >
                    <span className="flex items-center gap-2 font-semibold text-gray-800">
                      <CalendarDaysIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-400" />
                      {s.year} {s.type}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatChip value={activeDaysCount} label="aktív nap" />
                      <StatChip value={totalOrders} label="rendelés" />
                      <StatChip value={totalReserved} label="db csirke" />
                      <StatusBadge active={s.active} />
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>
                </h3>

                {expanded && (
                  <div id={`season-${s.id}`}>
                    {isEditing ? (
                      <Editor value={form} onChange={setForm} onSave={save} onCancel={cancelSeasonEdit} saving={saving} error={error} />
                    ) : (
                      <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ár és súly</p>
                            <p className="mt-1 text-sm text-gray-700">
                              <span className="font-medium text-gray-900">{s.price} Ft/kg</span> · {s.weightMin}–{s.weightMax} kg
                            </p>
                          </div>
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Előrendelési időszak</p>
                            <p className="mt-1 text-sm text-gray-700">
                              {s.orderStart ? formatDate(s.orderStart) : "–"} – {s.orderEnd ? formatDate(s.orderEnd) : "–"}
                            </p>
                          </div>
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Átvételi időpontok</p>
                            <p className="mt-1 text-sm text-gray-700">
                              Városi: {s.pickupTimeStart || "–"}–{s.pickupTimeEnd || "–"} · Tanyasi: {s.localPickupTimeStart || "–"}
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Átvételi napok</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {s.pickupDays.map((d) => {
                              const dayActive = d.active !== false;
                              return (
                                <div
                                  key={d.date}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-700">{formatDate(d.date)}</p>
                                    <p className="text-xs text-gray-500">
                                      Napi limit: {d.limit} db
                                      {d.orderCount ? ` · ${d.orderCount} rendelés · ${d.reservedQuantity ?? 0} db csirke` : ""}
                                    </p>
                                  </div>
                                  <StatusBadge active={dayActive} />
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {s.dunavecse && (
                          <div>
                            <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                              DUNAVECSE (Bács-Kiskun, technikai nap)
                              <InfoTip>
                                <p>
                                  A Bács-Kiskun vármegyei vásárlók rendelései automatikusan ehhez a naphoz kerülnek - nem
                                  szerkeszthető és nem törölhető, csak aktiválható/deaktiválható. Kapacitása korlátlan,
                                  nincs napi limitje.
                                </p>
                                <p className="mt-1.5">
                                  Deaktiváláskor a Bács-Kiskun vármegyei vásárlók nem tudnak új rendelést leadni erre a
                                  szezonra, de a már leadott rendeléseik változatlanul megmaradnak.
                                </p>
                              </InfoTip>
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-700">
                                  Vágási nap: {s.dunavecse.date ? formatDate(s.dunavecse.date) : "–"}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Korlátlan kapacitás
                                  {s.dunavecse.orderCount ? ` · ${s.dunavecse.orderCount} rendelés` : ""}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={dunavecseTogglingId === s.dunavecse.id}
                                onClick={() => toggleDunavecseActive(s.dunavecse!)}
                                className={statusBadgeClass(s.dunavecse.active) + " cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"}
                              >
                                {dunavecseTogglingId === s.dunavecse.id
                                  ? "…"
                                  : s.dunavecse.active
                                    ? <><CheckCircleIcon className="h-4 w-4" />Aktív</>
                                    : <><XCircleIcon className="h-4 w-4" />Inaktív</>}
                              </button>
                            </div>
                            {dunavecseError && (
                              <p className="mt-1.5 text-xs font-medium text-red-700">{dunavecseError}</p>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                          <button
                            type="button"
                            onClick={() => startEditingSeason(s)}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            Módosítás
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setConfirmDeleteId(s.id);
                              }}
                              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                            >
                              Törlés
                            </button>
                          )}
                        </div>

                        <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500">
                          <InformationCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                          <span>Csak olyan szezon törölhető, amelyhez sem aktív, sem lemondott rendelés nem tartozik.</span>
                        </div>

                        {confirmDeleteId === s.id && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
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
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                              >
                                Mégse
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
