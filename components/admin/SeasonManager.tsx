"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUturnLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  deleteSeason,
  restorePickupDay,
  restoreSeason,
  saveSeason,
  setDunavecsePickupDayActive,
  type PickupDay,
  type SeasonInput,
} from "@/app/(protected)/admin/seasons/actions";
import { SEASON_NOTE_MAX_LENGTH } from "@/lib/seasonNote";

// A DUNAVECSE (Bács-Kiskun) technikai nap - a normál pickupDays listától
// külön, mert nem szerkeszthető/törölhető a form-on keresztül, csak
// aktiválható/deaktiválható. Korlátlan kapacitású, ezért nincs limit
// mezője, de a hozzá tartozó rendelések/foglalások (orderCount,
// reservedQuantity) ugyanúgy megjelennek, mint a normál napoknál.
type DunavecseInfo = {
  id: number;
  date: string;
  active: boolean;
  orderCount: number;
  reservedQuantity: number;
  hasOrderHistory: boolean;
};

type ProductOption = { id: number; name: string };

// archived: törölt (soft delete) szezon; deletedDays: a szezon törölt napjai.
type Season = SeasonInput & {
  id: string;
  created_at: string;
  dunavecse: DunavecseInfo | null;
  archived: boolean;
  deletedDays: PickupDay[];
};

// A régi, szezononkénti ár (season_parameters.price) egyelőre kötelező: a
// legkisebb azonosítójú termék (Egész) árát tükrözi.
const withLegacyPrice = (input: SeasonInput, products: ProductOption[]): SeasonInput => {
  const first = [...products].sort((a, b) => a.id - b.id)[0];
  const price = input.prices?.find((entry) => entry.productId === first?.id)?.price;
  return price === undefined ? input : { ...input, price };
};

const blank = (products: ProductOption[] = []): SeasonInput => ({
  year: new Date().getFullYear(),
  type: "Tavasz",
  price: 0,
  prices: products.map((product) => ({ productId: product.id, price: 0 })),
  note: "",
  weightMin: 2,
  weightMax: 3,
  orderStart: "",
  orderEnd: "",
  pickupTimeStart: "17:00",
  pickupTimeEnd: "18:00",
  localPickupTimeStart: "17:00",
  pickupDays: [{ date: "", limit: 1, active: true, smallSizeLimit: null, largeSizeLimit: null }],
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
      title="Az átvételi naphoz tartozó aktív rendelések száma és a lefoglalt csirkék mennyisége."
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
  // A külső érték változásakor a szöveg újraszinkronizálása renderelés közben
  // történik (nem effektben), ahogy a React ajánlja.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(String(value));
  }

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

// Opcionális napi méretlimit: az üres mező "nincs korlát" (null).
function LimitField({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="Korlátlan"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, "");
        onChange(raw === "" ? null : Number(raw));
      }}
      className={inputClass}
    />
  );
}

function Editor({
  value,
  products,
  liveConfirmMessage,
  onConfirmLive,
  onDismissLive,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  dunavecse,
  dunavecseToggling,
  dunavecseError,
  onToggleDunavecse,
}: {
  value: SeasonInput;
  products: ProductOption[];
  // Ha a mentés élő rendelésű nap törlését is jelentené, a szerver megerősítést
  // kér: ez a szöveg jelenik meg, a "Mentés megerősítéssel" gomb pedig
  // confirmLiveOrders jelzéssel újraküldi a mentést.
  liveConfirmMessage?: string | null;
  onConfirmLive?: () => void;
  onDismissLive?: () => void;
  onChange: (v: SeasonInput) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error?: string | null;
  dunavecse?: DunavecseInfo | null;
  dunavecseToggling?: boolean;
  dunavecseError?: string | null;
  onToggleDunavecse?: (d: DunavecseInfo) => void;
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

      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
        {products.map((product) => (
          <label key={product.id}>
            <span className={labelClass}>{product.name} ára (Ft/kg)</span>
            <NumberField
              value={value.prices?.find((entry) => entry.productId === product.id)?.price ?? 0}
              onChange={(v) =>
                onChange(
                  withLegacyPrice(
                    {
                      ...value,
                      prices: [
                        ...(value.prices ?? []).filter((entry) => entry.productId !== product.id),
                        { productId: product.id, price: v },
                      ],
                    },
                    products
                  )
                )
              }
            />
          </label>
        ))}
      </div>

      <label className="sm:col-span-2">
        <span className={labelClass}>
          Megjegyzés <span className="font-normal text-gray-400">(nem kötelező, csak az admin felületen látszik)</span>
        </span>
        <input
          type="text"
          maxLength={SEASON_NOTE_MAX_LENGTH}
          value={value.note ?? ""}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          className={inputClass}
        />
        <span className="mt-1 block text-right text-xs text-gray-400">
          {(value.note ?? "").length}/{SEASON_NOTE_MAX_LENGTH}
        </span>
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
              A törölt átvételi nap nem vész el: a szezon kártyáján, a „Törölt napok” között visszaállítható
              (inaktívként). A napra korábban leadott rendelések megmaradnak. Ha a naphoz élő rendelés tartozik,
              mentéskor külön megerősítést kérünk.
            </p>
            <p className="mt-1.5">
              A kisebb/nagyobb méret limit a napra rendelhető, átlagostól kisebb/nagyobb méretű csirkék legnagyobb
              darabszáma. Üresen hagyva nincs korlát.
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

              <label className="w-28">
                <span className={labelClass}>Kisebb méret</span>
                <LimitField value={d.smallSizeLimit} onChange={(v) => days((x, j) => (j === i ? { ...x, smallSizeLimit: v } : x))} />
              </label>

              <label className="w-28">
                <span className={labelClass}>Nagyobb méret</span>
                <LimitField value={d.largeSizeLimit} onChange={(v) => days((x, j) => (j === i ? { ...x, largeSizeLimit: v } : x))} />
              </label>

              {value.active && (
                <ActiveCheckbox
                  active={dayActive}
                  onChange={() => days((x, j) => (j === i ? { ...x, active: !dayActive } : x))}
                />
              )}

              {d.id != null && (
                <OrderStatsCard
                  orderCount={d.orderCount ?? 0}
                  reservedQuantity={d.reservedQuantity ?? 0}
                />
              )}

              <button
                type="button"
                onClick={() => onChange({ ...value, pickupDays: value.pickupDays.filter((_, j) => j !== i) })}
                disabled={value.pickupDays.length === 1}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Átvételi nap törlése"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        {value.pickupDays.length < 5 && (
          <button
            type="button"
            onClick={() => onChange({ ...value, pickupDays: [...value.pickupDays, { date: "", limit: 1, active: true, smallSizeLimit: null, largeSizeLimit: null }] })}
            className="flex items-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition hover:border-[rgb(49,171,2)] hover:text-[rgb(49,171,2)]"
          >
            <PlusIcon className="h-4 w-4" />
            Átvételi nap hozzáadása
          </button>
        )}
      </div>

      {dunavecse && (
        <div className="space-y-2 sm:col-span-2">
          <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            DUNAVECSE (Bács-Kiskun, technikai nap)
            <InfoTip>
              <p>
                A Bács-Kiskun vármegyei vásárlók rendelései automatikusan ehhez a naphoz kerülnek - nem szerkeszthető
                és nem törölhető, csak aktiválható/deaktiválható. Kapacitása korlátlan, nincs napi limitje.
              </p>
              <p className="mt-1.5">
                Deaktiváláskor a Bács-Kiskun vármegyei vásárlók nem tudnak új rendelést leadni erre a szezonra, de a
                már leadott rendeléseik változatlanul megmaradnak.
              </p>
            </InfoTip>
          </p>
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <div className="min-w-[10rem] flex-1">
              <p className="truncate text-sm font-medium text-gray-700">
                Vágási nap: {dunavecse.date ? formatDate(dunavecse.date) : "–"}
              </p>
              <p className="text-xs text-gray-500">Korlátlan kapacitás</p>
            </div>

            <ActiveCheckbox
              active={dunavecse.active}
              loading={dunavecseToggling}
              onChange={() => onToggleDunavecse?.(dunavecse)}
            />

            <OrderStatsCard orderCount={dunavecse.orderCount} reservedQuantity={dunavecse.reservedQuantity} />
          </div>
          {dunavecseError && <p className="text-xs font-medium text-red-700">{dunavecseError}</p>}
        </div>
      )}

      <label className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          checked={value.active}
          onChange={(e) => onChange({ ...value, active: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]"
        />
        <span className="text-sm font-medium text-gray-700">Szezon aktiválása</span>
      </label>

      {liveConfirmMessage && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:col-span-2">
          <p className="text-sm font-medium text-amber-900">{liveConfirmMessage}</p>
          <p className="mt-1 text-xs text-amber-800">
            A törölt nap visszaállítható, a napra leadott rendelések megmaradnak és élők maradnak.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onConfirmLive}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? "Mentés…" : "Mentés megerősítéssel"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onDismissLive}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Mégse
            </button>
          </div>
        </div>
      )}

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

export default function SeasonManager({ seasons, products }: { seasons: Season[]; products: ProductOption[] }) {
  const [form, setForm] = useState(blank(products));
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
  const [liveConfirmMessage, setLiveConfirmMessage] = useState<string | null>(null);
  // restoringKey: "season-<id>" vagy "day-<id>" - melyik visszaállítás fut.
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
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
    setForm(blank(products));
    setError(null);
    setLiveConfirmMessage(null);
  };

  const cancelSeasonEdit = () => {
    setEditingId(null);
    setForm(blank(products));
    setError(null);
    setLiveConfirmMessage(null);
  };

  const toggleExpand = (id: string) => {
    setOpen(false);
    setConfirmDeleteId(null);
    setError(null);
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
      setForm(blank(products));
    } else {
      setExpandedId(id);
      setEditingId(null);
      setForm(blank(products));
    }
  };

  const startEditingSeason = (s: Season) => {
    // Régebbi, a felület bevezetése előtt létrehozott szezonoknál ezek a
    // mezők üresek lehetnek az adatbázisban. A TimeSelect ilyenkor is mutat
    // egy alapértelmezett órát/percet, hogy ne legyen üres választható elem -
    // de ha ezt nem szinkronizálnánk vissza a form állapotába, a mentés az
    // űrlapon látszólag már kitöltött mezőket is üresként utasítaná el.
    // Az árak minden termékhez szerepelnek a formban (a hiányzó, pl. újonnan
    // felvett termék ára 0-ról indul), a szezon extra mezői (törölt napok,
    // DUNAVECSE stb.) nem kerülnek a mentési kérésbe.
    setForm({
      id: s.id,
      year: s.year,
      type: s.type,
      price: s.price,
      prices: products.map((product) => ({
        productId: product.id,
        price: s.prices?.find((entry) => entry.productId === product.id)?.price ?? 0,
      })),
      note: s.note ?? "",
      weightMin: s.weightMin,
      weightMax: s.weightMax,
      orderStart: s.orderStart,
      orderEnd: s.orderEnd,
      pickupTimeStart: s.pickupTimeStart || "17:00",
      pickupTimeEnd: s.pickupTimeEnd || "18:00",
      localPickupTimeStart: s.localPickupTimeStart || "17:00",
      pickupDays: s.pickupDays.map((d) => ({ ...d })),
      active: s.active,
    });
    setEditingId(s.id);
    setError(null);
    setLiveConfirmMessage(null);
  };

  const save = async (confirmLiveOrders = false) => {
    setSaving(true);
    setError(null);
    setLiveConfirmMessage(null);
    try {
      const r = await saveSeason({ ...form, confirmLiveOrders });
      if (r.success) closeEditor();
      else if (r.needsConfirmation) setLiveConfirmMessage(r.error);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "A szezon mentése váratlan hiba miatt sikertelen.");
    } finally {
      setSaving(false);
    }
  };

  const restore = async (key: string, run: () => ReturnType<typeof restoreSeason>) => {
    setRestoringKey(key);
    setRestoreError(null);
    const r = await run();
    if (!r.success) setRestoreError(r.error);
    setRestoringKey(null);
  };

  // A törlés megerősítő panelje már kiírja, ha élő rendelés tartozik a
  // szezonhoz; a megerősítés ezért confirmLiveOrders = true jelzéssel megy ki.
  const remove = async (id: string) => {
    setDeletingId(id);
    setDeleteError(null);
    const r = await deleteSeason(id, true);
    if (r.success) {
      setConfirmDeleteId(null);
      if (expandedId === id) {
        setExpandedId(null);
        setEditingId(null);
        setForm(blank(products));
      }
    } else setDeleteError(r.error);
    setDeletingId(null);
  };

  return (
    <div className="space-y-4">
      <section className={cardHighlightClass(open)}>
        <button
          type="button"
          onClick={() => (open ? closeEditor() : (setForm(blank(products)), setExpandedId(null), setEditingId(null), setOpen(true)))}
          className="flex w-full items-center gap-3 text-left"
        >
          <PlusIcon className="h-5 w-5 text-[rgb(49,171,2)]" />
          <span className="flex-1 font-semibold text-gray-800">Új szezon</span>
          <span className="text-gray-400">{open ? "−" : "+"}</span>
        </button>

        {open && <Editor value={form} products={products} onChange={setForm} onSave={() => save()} onCancel={closeEditor} saving={saving} error={error} />}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-800">Korábbi és aktuális szezonok</h2>

        <div className="grid gap-3">
          {seasons.filter((s) => !s.archived).map((s) => {
            const expanded = expandedId === s.id;
            const isEditing = editingId === s.id;
            const activeDaysCount = s.pickupDays.filter((d) => d.active !== false).length;
            const totalOrders = s.pickupDays.reduce((sum, d) => sum + (d.orderCount ?? 0), 0);
            const totalReserved = s.pickupDays.reduce((sum, d) => sum + (d.reservedQuantity ?? 0), 0);
            // A szezon törlése (soft delete) bármikor lehetséges. Az élő (aktív)
            // rendelések - a törölt napokéi és a DUNAVECSE napéi is - külön
            // figyelmeztetést kapnak a törlés megerősítésekor.
            const liveOrders =
              totalOrders +
              (s.dunavecse?.orderCount ?? 0) +
              s.deletedDays.reduce((sum, d) => sum + (d.orderCount ?? 0), 0);

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
                    <span className="min-w-0 max-w-full">
                      <span className="flex items-center gap-2 font-semibold text-gray-800">
                        <CalendarDaysIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-400" />
                        {s.year} {s.type}
                      </span>
                      {s.note && (
                        <span className="mt-0.5 block truncate pl-7 text-xs font-normal text-gray-500" title={s.note}>
                          {s.note}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatChip
                        value={s.dunavecse ? `${activeDaysCount} + ${s.dunavecse.active ? 1 : 0}` : activeDaysCount}
                        label="aktív nap"
                      />
                      <StatChip
                        value={s.dunavecse ? `${totalOrders} + ${s.dunavecse.orderCount}` : totalOrders}
                        label="rendelés"
                      />
                      <StatChip
                        value={s.dunavecse ? `${totalReserved} db + ${s.dunavecse.reservedQuantity} db` : totalReserved}
                        label={s.dunavecse ? "csirke" : "db csirke"}
                      />
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
                      <Editor
                        value={form}
                        products={products}
                        liveConfirmMessage={liveConfirmMessage}
                        onConfirmLive={() => save(true)}
                        onDismissLive={() => setLiveConfirmMessage(null)}
                        onChange={setForm}
                        onSave={() => save()}
                        onCancel={cancelSeasonEdit}
                        saving={saving}
                        error={error}
                        dunavecse={s.dunavecse}
                        dunavecseToggling={dunavecseTogglingId === s.dunavecse?.id}
                        dunavecseError={dunavecseError}
                        onToggleDunavecse={toggleDunavecseActive}
                      />
                    ) : (
                      <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Árak és súly</p>
                            <p className="mt-1 text-sm text-gray-700">
                              {products.map((product, index) => (
                                <span key={product.id}>
                                  {index > 0 && " · "}
                                  {product.name}:{" "}
                                  <span className="font-medium text-gray-900">
                                    {s.prices?.find((entry) => entry.productId === product.id)?.price ?? "–"} Ft/kg
                                  </span>
                                </span>
                              ))}
                            </p>
                            <p className="mt-0.5 text-sm text-gray-700">
                              Súly: {s.weightMin}–{s.weightMax} kg
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
                          {s.note && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Megjegyzés</p>
                              <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-700">{s.note}</p>
                            </div>
                          )}
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
                                      {d.smallSizeLimit != null ? ` · kisebb méret: ${d.smallSizeLimit} db` : ""}
                                      {d.largeSizeLimit != null ? ` · nagyobb méret: ${d.largeSizeLimit} db` : ""}
                                      {d.orderCount ?` · ${d.orderCount} rendelés · ${d.reservedQuantity ?? 0} db csirke` : ""}
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
                                  {s.dunavecse.orderCount
                                    ? ` · ${s.dunavecse.orderCount} rendelés · ${s.dunavecse.reservedQuantity ?? 0} db csirke`
                                    : ""}
                                </p>
                              </div>
                              <StatusBadge active={s.dunavecse.active} />
                            </div>
                          </div>
                        )}

                        {s.deletedDays.length > 0 && (
                          <div>
                            <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                              Törölt napok
                              <InfoTip>
                                <p>
                                  A visszaállított nap inaktívként kerül vissza, a rá leadott rendelések változatlanok.
                                  Aktiválni a szezon szerkesztésénél lehet.
                                </p>
                              </InfoTip>
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {s.deletedDays.map((d) => (
                                <div
                                  key={d.id}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-white p-2.5"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-500 line-through">{formatDate(d.date)}</p>
                                    <p className="text-xs text-gray-500">
                                      {d.orderCount ? `${d.orderCount} élő rendelés` : "Nincs élő rendelés"}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={restoringKey !== null}
                                    onClick={() => d.id != null && restore(`day-${d.id}`, () => restorePickupDay(d.id as number))}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                                  >
                                    <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
                                    {restoringKey === `day-${d.id}` ? "Visszaállítás…" : "Visszaállítás"}
                                  </button>
                                </div>
                              ))}
                            </div>
                            {restoreError && <p className="mt-2 text-xs font-medium text-red-700">{restoreError}</p>}
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
                        </div>

                        <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500">
                          <InformationCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                          <span>
                            A szezon bármikor törölhető. A törölt szezon a lap alján, a „Törölt szezonok” között
                            visszaállítható (inaktívként), a rendelések megmaradnak.
                          </span>
                        </div>

                        {confirmDeleteId === s.id && (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                            <p className="text-sm text-red-700">
                              Biztosan törli ezt a szezont az összes átvételi napjával együtt? A szezon később
                              visszaállítható.
                            </p>
                            {liveOrders > 0 && (
                              <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm font-medium text-amber-900">
                                Figyelem: a szezonhoz {liveOrders} élő rendelés tartozik. A rendelések nem törlődnek, de a
                                szezon törlése után a vásárlók már nem tudják módosítani őket (lemondani továbbra is tudják).
                                {s.active ? " A szezon jelenleg aktív." : ""}
                              </p>
                            )}
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

      {seasons.some((s) => s.archived) && (
        <section>
          <h2 className="mb-2 text-lg font-semibold text-gray-800">Törölt szezonok</h2>
          <div className="grid gap-3">
            {seasons
              .filter((s) => s.archived)
              .map((s) => (
                <article key={s.id} className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-gray-500">
                        <CalendarDaysIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-400" />
                        <span className="line-through">
                          {s.year} {s.type}
                        </span>
                        <span className="rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500 no-underline">
                          Törölve
                        </span>
                      </p>
                      {s.note && <p className="mt-0.5 truncate pl-7 text-xs text-gray-500" title={s.note}>{s.note}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={restoringKey !== null}
                      onClick={() => restore(`season-${s.id}`, () => restoreSeason(s.id))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                    >
                      <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
                      {restoringKey === `season-${s.id}` ? "Visszaállítás…" : "Visszaállítás"}
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A visszaállított szezon és napjai inaktívként kerülnek vissza. Aktiválni a szezon szerkesztésénél lehet.
          </p>
          {restoreError && <p className="mt-2 text-sm font-medium text-red-700">{restoreError}</p>}
        </section>
      )}
    </div>
  );
}
