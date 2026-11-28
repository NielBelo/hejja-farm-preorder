"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUturnLeftIcon,
  CheckBadgeIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  deleteSeason,
  restoreSeason,
  saveSeason,
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
  // Törölt szezonnál a fejléc statisztikája (napok, rendelések, db csirke).
  archivedStats: { days: number; orders: number; quantity: number; dunavecse: { days: number; orders: number; quantity: number } | null };
};

// A régi, szezononkénti ár (season_parameters.price) egyelőre kötelező: a
// legkisebb azonosítójú termék (Egész) árát tükrözi.
const withLegacyPrice = (input: SeasonInput, products: ProductOption[]): SeasonInput => {
  const first = [...products].sort((a, b) => a.id - b.id)[0];
  const price = input.prices?.find((entry) => entry.productId === first?.id)?.price;
  return price === undefined ? input : { ...input, price };
};

// Új átvételi nap alapértelmezett méretlimitjei.
const DEFAULT_SMALL_SIZE_LIMIT = 20;
const DEFAULT_LARGE_SIZE_LIMIT = 40;

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
  pickupDays: [{ date: "", limit: 1, active: true, smallSizeLimit: DEFAULT_SMALL_SIZE_LIMIT, largeSizeLimit: DEFAULT_LARGE_SIZE_LIMIT }],
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
// Csak jelző (nem kattintható): lapos szöveg színes ponttal, keret, háttér és
// árnyék nélkül, hogy ne tűnjön gombnak. A fix szélesség miatt az Aktív /
// Inaktív / Törölve felirat nem tolja el a sort.
const statusIndicatorClass = "inline-flex w-20 shrink-0 items-center gap-2 text-sm font-semibold";
// Minimalista színkódolás: a szakaszokat nem a háttér, hanem a keret egy vékony,
// színes sávja (bal oldal) és a hozzá illő címszín jelöli. A teljes osztálynevek
// szerepelnek a forrásban, hogy a Tailwind biztosan legenerálja őket.
const ACCENTS = {
  gray: { bar: "border-l-gray-500", text: "text-gray-500" },
  blue: { bar: "border-l-blue-600", text: "text-blue-600" },
  green: { bar: "border-l-green-600", text: "text-green-600" },
  orange: { bar: "border-l-orange-600", text: "text-orange-600" },
  purple: { bar: "border-l-purple-600", text: "text-purple-600" },
  pink: { bar: "border-l-pink-600", text: "text-pink-600" },
} as const;
type Accent = keyof typeof ACCENTS;

const cardHighlightClass = (highlighted: boolean) =>
  `rounded-xl bg-white p-4 transition-all ${
    highlighted
      ? "border-2 border-[rgb(138,115,85)] shadow-lg ring-2 ring-[rgba(138,115,85,0.18)]"
      : "border border-gray-200 shadow-sm"
  }`;

// A megtekintő nézet építőkockái: címkézett adatsorok kártyában, és címkézett
// mezők egy napon belül, hogy az adatok ne follyanak össze.
function SectionLabel({ children, accent }: { children: React.ReactNode; accent?: Accent }) {
  return (
    <p className={`text-xs font-semibold uppercase tracking-wide ${accent ? ACCENTS[accent].text : "text-gray-400"}`}>
      {children}
    </p>
  );
}

function InfoCard({ title, rows, accent }: { title: string; rows: [string, React.ReactNode][]; accent: Accent }) {
  return (
    <div className={`rounded-lg border border-l-[3px] border-gray-200 ${ACCENTS[accent].bar} bg-white p-3`}>
      <SectionLabel accent={accent}>{title}</SectionLabel>
      <dl className="mt-2 divide-y divide-gray-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
            <dt className="text-sm text-gray-500">{label}</dt>
            <dd className="text-right text-sm font-semibold tabular-nums text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Egy szakasz a szerkesztőben: címke fent, a mezők kártyában.
function EditorSection({
  title,
  hint,
  accent,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  accent: Accent;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-l-4 border-gray-200 ${ACCENTS[accent].bar} bg-white px-4 py-3`}>
      <div className="mb-2 flex items-center gap-1">
        <SectionLabel accent={accent}>{title}</SectionLabel>
        {hint}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}

// Egy átvételi nap kártyája: fejlécben a dátum és az állapot, alatta a
// címkézett számok.
function DayCard({
  title,
  status,
  facts,
  muted = false,
  accent = "orange",
}: {
  title: React.ReactNode;
  status: React.ReactNode;
  facts: [string, React.ReactNode][];
  muted?: boolean;
  accent?: Accent;
}) {
  return (
    <div
      className={`rounded-lg border border-l-[3px] bg-white ${
        muted ? `border-dashed border-gray-300 ${ACCENTS.gray.bar}` : `border-gray-200 ${ACCENTS[accent].bar}`
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <p className={`min-w-0 truncate text-sm font-semibold ${muted ? "text-gray-500 line-through" : "text-gray-800"}`}>
          {title}
        </p>
        {status}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3 py-2.5 sm:grid-cols-5">
        {facts.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
  );
}

const formatCount = (value: number) => value.toLocaleString("hu-HU");
const formatLimit = (value: number | null | undefined) => (value == null ? "Korlátlan" : `${formatCount(value)} db`);
// A limit és mellette zárójelben a már rendelt mennyiség.
const formatLimitUsage = (limit: number | null | undefined, ordered: number | undefined) =>
  `${formatLimit(limit)} (rendelve: ${formatCount(ordered ?? 0)} db)`;

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`${statusIndicatorClass} ${active ? "text-green-600" : "text-gray-500"}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-green-600" : "bg-gray-500"}`} />
      {active ? "Aktív" : "Inaktív"}
    </span>
  );
}

// A törölt (archivált) nap/szezon jelzője: ugyanolyan lapos jelző, mint az
// Aktív/Inaktív, ugyanakkora hellyel.
// A törölt napok alapból összecsukva; a gomb lenyitja/visszacsukja őket.
function DeletedDaysToggle({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        {open ? "Törölt napok elrejtése" : "Törölt napok megjelenítése"} ({count})
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function DeletedBadge() {
  return (
    <span className={`${statusIndicatorClass} text-red-600`}>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-red-600" />
      Törölve
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
      className={`flex h-11 w-28 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
        active ? "border-green-600 bg-white text-green-600" : "border-gray-300 bg-white text-gray-500"
      } ${disabled || loading ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={active}
        disabled={disabled || loading}
        onChange={onChange}
        className="h-4 w-4 rounded border-gray-300 text-[rgb(67,133,45)] focus:ring-[rgb(67,133,45)]"
      />
      {loading ? "…" : active ? "Aktív" : "Inaktív"}
    </label>
  );
}

// Kattintásra megjelenő, kattintással rejtett rövid magyarázat egy mező
// vagy szakasz mellett, hogy a tartósan látható szöveg ne foglaljon
// helyet, amíg az admin nem kér róla részletet.
// Egységes üzenetdoboz minden hibához, figyelmeztetéshez és visszajelzéshez:
// ikon + félkövér cím + magyarázat, a tónust a keret és az ikon színe jelzi
// (error: piros, warning: borostyán, success: zöld). Opcionális gombsor
// (megerősítő panelekhez).
const NOTICE_TONES = {
  error: { border: "border-red-600", text: "text-red-600", Icon: ExclamationTriangleIcon, role: "alert" },
  warning: { border: "border-amber-600", text: "text-amber-600", Icon: InformationCircleIcon, role: "alert" },
  success: { border: "border-green-600", text: "text-green-600", Icon: CheckCircleIcon, role: "status" },
} as const;

function Notice({
  tone,
  title,
  children,
  actions,
  className = "",
  reveal = false,
}: {
  tone: keyof typeof NOTICE_TONES;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  // Megjelenéskor a képernyő közepére görget, hogy az üzenet teljesen látszódjon.
  reveal?: boolean;
}) {
  const t = NOTICE_TONES[tone];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [reveal]);
  return (
    <div ref={ref} role={t.role} className={`flex items-start gap-2 rounded-lg border ${t.border} bg-white p-3 ${className}`}>
      <t.Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${t.text}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${t.text}`}>{title}</p>
        {children && <div className="mt-0.5 space-y-1 text-sm text-gray-700">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const noticeConfirmButtonClass =
  "rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60";
const noticeCancelButtonClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-60";

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
        <div className="absolute left-0 top-full z-40 mt-1.5 w-64 space-y-1.5 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-600 shadow-lg">
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

// Csak tájékoztató sor (nem beviteli mező): az átvételi naphoz tartozó aktív
// rendelések száma és a lefoglalt csirkék mennyisége.
function OrderStatsLine({
  orderCount,
  reservedQuantity,
  smallQuantity,
  largeQuantity,
  className = "",
}: {
  orderCount: number;
  reservedQuantity: number;
  smallQuantity?: number;
  largeQuantity?: number;
  className?: string;
}) {
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      Aktív rendelés: <span className="font-semibold text-gray-700">{orderCount}</span>
      <span className="mx-1.5 text-gray-300">·</span>
      Lefoglalt csirke: <span className="font-semibold text-gray-700">{reservedQuantity} db</span>
      {smallQuantity !== undefined && (
        <>
          <span className="mx-1.5 text-gray-300">·</span>
          Kisebb méretű: <span className="font-semibold text-gray-700">{smallQuantity} db</span>
        </>
      )}
      {largeQuantity !== undefined && (
        <>
          <span className="mx-1.5 text-gray-300">·</span>
          Nagyobb méretű: <span className="font-semibold text-gray-700">{largeQuantity} db</span>
        </>
      )}
    </p>
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
          isOpen ? "border-[rgb(67,133,45)] ring-2 ring-[rgb(67,133,45)]/10" : "border-gray-300"
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
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-base text-gray-800 transition-colors hover:bg-[#F0F5EB] ${
                    isSelected ? "bg-[#F0F5EB] font-medium" : "bg-white"
                  }`}
                >
                  <span>{o.label}</span>
                  {isSelected && <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(67,133,45)]" />}
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
  deletedDays = [],
  liveConfirmMessage,
  onConfirmLive,
  onDismissLive,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  dunavecse,
  savedActive = false,
}: {
  value: SeasonInput;
  products: ProductOption[];
  // A szezon mentett (adatbázisbeli) aktív állapota; új szezonnál false.
  savedActive?: boolean;
  // A szezon törölt (archivált) napjai: csak szerkesztés közben állíthatók
  // vissza, úgy, hogy a nap visszakerül az űrlapba, és a Mentés állítja vissza.
  deletedDays?: PickupDay[];
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
}) {
  const days = (fn: (d: SeasonInput["pickupDays"][number], i: number) => SeasonInput["pickupDays"][number]) =>
    onChange({ ...value, pickupDays: value.pickupDays.map(fn) });

  // A szerkesztés közben törölt (mentett) napok mentésig a törölt napok között
  // jelennek meg, onnan egy kattintással visszavehetők; a törlés mentéskor történik.
  const [removedDays, setRemovedDays] = useState<SeasonInput["pickupDays"]>([]);
  const removeDay = (index: number) => {
    const day = value.pickupDays[index];
    if (day.id != null) setRemovedDays((prev) => [...prev, day]);
    onChange({ ...value, pickupDays: value.pickupDays.filter((_, j) => j !== index) });
  };
  const restoreRemovedDay = (day: SeasonInput["pickupDays"][number]) => {
    setRemovedDays((prev) => prev.filter((x) => x.id !== day.id));
    onChange({ ...value, pickupDays: [...value.pickupDays, day] });
  };
  const listedDeletedDays = [
    ...removedDays.map((d) => ({ day: d, pending: true })),
    ...deletedDays.map((d) => ({ day: d as SeasonInput["pickupDays"][number], pending: false })),
  ].filter(({ day }) => !value.pickupDays.some((x) => x.id === day.id));

  // Az aktiválás nem kapcsolja be a napokat: figyelmeztetésben mutatjuk, melyek
  // maradnak inaktívak (a technikai DUNAVECSE napot is külön kell aktiválni).
  const inactiveDays = value.pickupDays.filter((d) => d.active === false);
  const inactiveDayNames = [
    ...inactiveDays.map((d) => (d.date ? formatDate(d.date) : "új nap")),
    ...(dunavecse && !(value.dunavecseActive ?? dunavecse.active) ? ["DUNAVECSE"] : []),
  ];
  const inactiveDayCount = inactiveDayNames.length;
  // A figyelmeztetés csak frissen bekapcsolt, még nem mentett aktiváláskor kell.
  const newlyActivated = value.active && !savedActive;

  // A már leadott rendelések alá egyik limit sem csökkenthető (a szerver is
  // ellenőrzi; itt mentés előtt jelezzük). Emelés és korlátlanra állítás mindig
  // lehetséges.
  const dayLimitProblem = (d: SeasonInput["pickupDays"][number]) => {
    if (d.id == null) return null;
    if ((d.reservedQuantity ?? 0) > d.limit) {
      return `A napi limit nem lehet kisebb a már lefoglalt mennyiségnél (${d.reservedQuantity} db).`;
    }
    if (d.smallSizeLimit != null && d.smallSizeLimit < (d.liveSmallQuantity ?? 0)) {
      return `A kisebb méret limit nem lehet kisebb a már rendelt kisebb méretű mennyiségnél (${d.liveSmallQuantity} db).`;
    }
    if (d.largeSizeLimit != null && d.largeSizeLimit < (d.liveLargeQuantity ?? 0)) {
      return `A nagyobb méret limit nem lehet kisebb a már rendelt nagyobb méretű mennyiségnél (${d.liveLargeQuantity} db).`;
    }
    return null;
  };
  const hasLimitProblem = value.pickupDays.some((d) => dayLimitProblem(d) !== null);

  // Egy meglévő szezon éve elméletileg kívül eshet az alapértelmezett
  // tartományon (pl. régebbi szezon szerkesztésekor); ilyenkor a jelenlegi
  // értéket is felvesszük a listába, hogy a mentés ne cserélje le észrevétlenül.
  const yearOptions = Array.from(new Set([...getYearOptions(), value.year])).sort((a, b) => a - b);

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <EditorSection title="Alapadatok" accent="gray">
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>
      </EditorSection>

      <EditorSection title="Árak" accent="green">
        <div className="grid gap-3 sm:grid-cols-3">
          {products.map((product) => (
            <label key={product.id}>
              <span className={labelClass}>{product.name} (Ft/kg)</span>
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
      </EditorSection>

      <EditorSection title="Előrendelés" accent="blue">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <span className={labelClass}>Min. súly (kg)</span>
            <NumberField decimal min={0.1} value={value.weightMin} onChange={(v) => onChange({ ...value, weightMin: v })} />
          </label>

          <label>
            <span className={labelClass}>Max. súly (kg)</span>
            <NumberField decimal min={0.1} value={value.weightMax} onChange={(v) => onChange({ ...value, weightMax: v })} />
          </label>
        </div>
      </EditorSection>

      <EditorSection title="Átvételi időpontok" accent="purple">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-800">
              Városi átvétel
              <InfoTip>Minden átvételi napra vonatkozik. A Békés és Bács-Kiskun megyei vásárlók kivételével.</InfoTip>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <span className={labelClass}>Kezdete</span>
                <TimeSelect value={value.pickupTimeStart} onChange={(v) => onChange({ ...value, pickupTimeStart: v })} />
              </div>
              <div>
                <span className={labelClass}>Vége</span>
                <TimeSelect value={value.pickupTimeEnd} onChange={(v) => onChange({ ...value, pickupTimeEnd: v })} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-800">
              Tanyasi átvétel
              <InfoTip>Minden átvételi napra vonatkozik, kizárólag a Békés megyei vásárlók számára.</InfoTip>
            </div>
            <div className="mt-2">
              <span className={labelClass}>Kezdete</span>
              <TimeSelect
                value={value.localPickupTimeStart}
                onChange={(v) => onChange({ ...value, localPickupTimeStart: v })}
              />
            </div>
          </div>
        </div>
      </EditorSection>

      <EditorSection
        title="Átvételi napok"
        accent="orange"
        hint={
          <InfoTip>
            <p>
              Méret limit: a kisebb/nagyobb méretű csirkék legnagyobb darabszáma a napon, üresen nincs korlát. A
              már rendelt mennyiség alá nem csökkenthető.
            </p>
            {value.active && (
              <p className="mt-1.5">Inaktív napra nem lehet rendelni, a meglévő rendelések megmaradnak.</p>
            )}
            <p className="mt-1.5">
              Törölt napnál a rendelések is törlődnek: a vásárló nem kap róla e-mailt, és az előzményeiből is
              eltűnnek. Visszaállításkor visszakerülnek. Ha a napnak van élő (nem lemondott) rendelése, a törlést
              mentéskor külön meg kell erősítenie.
            </p>
          </InfoTip>
        }
      >
        <div className="space-y-2">
          {value.pickupDays.map((d, i) => {
            const dayActive = d.active !== false;
            return (
              <div key={i} className="rounded-lg border border-gray-200 px-3 py-2.5">
                <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                  <label className="w-40">
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

                  <label className="w-36">
                    <span className={labelClass}>Kisebb méret limit</span>
                    <LimitField
                      value={d.smallSizeLimit}
                      onChange={(v) => days((x, j) => (j === i ? { ...x, smallSizeLimit: v } : x))}
                    />
                  </label>

                  <label className="w-36">
                    <span className={labelClass}>Nagyobb méret limit</span>
                    <LimitField
                      value={d.largeSizeLimit}
                      onChange={(v) => days((x, j) => (j === i ? { ...x, largeSizeLimit: v } : x))}
                    />
                  </label>

                  {value.active && (
                    <ActiveCheckbox
                      active={dayActive}
                      onChange={() => days((x, j) => (j === i ? { ...x, active: !dayActive } : x))}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => removeDay(i)}
                    disabled={value.pickupDays.length === 1}
                    className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Átvételi nap törlése"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                {d.id != null && (
                  <OrderStatsLine
                    className="mt-1.5"
                    orderCount={d.orderCount ?? 0}
                    reservedQuantity={d.reservedQuantity ?? 0}
                    smallQuantity={d.liveSmallQuantity ?? 0}
                    largeQuantity={d.liveLargeQuantity ?? 0}
                  />
                )}

                {dayLimitProblem(d) && (
                  <Notice tone="error" title="A limit túl alacsony" className="mt-2">
                    <p>{dayLimitProblem(d)}</p>
                  </Notice>
                )}
              </div>
            );
          })}

          {value.pickupDays.length < 5 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  pickupDays: [
                    ...value.pickupDays,
                    {
                      date: "",
                      limit: 1,
                      active: true,
                      smallSizeLimit: DEFAULT_SMALL_SIZE_LIMIT,
                      largeSizeLimit: DEFAULT_LARGE_SIZE_LIMIT,
                    },
                  ],
                })
              }
              className="flex items-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 px-3 py-2 text-sm font-medium text-gray-500 transition hover:border-[rgb(67,133,45)] hover:text-[rgb(67,133,45)]"
            >
              <PlusIcon className="h-4 w-4" />
              Átvételi nap hozzáadása
            </button>
          )}
        </div>

        {listedDeletedDays.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
           <DeletedDaysToggle count={listedDeletedDays.length}>
            <div className="space-y-2">
            <div className="inline-flex items-center gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Törölt napok</span>
              <InfoTip>
                <p>
                  A törölt nap rendelései is törölve vannak: a vásárló nem kap róla e-mailt, és az előzményeiből is
                  eltűnnek. (Az inaktív nap rendelései ezzel szemben megmaradnak.)
                </p>
                <p className="mt-1.5">
                  Visszaállításkor a nap inaktívként kerül vissza az űrlapba, a rendeléseivel együtt a Mentés után
                  áll vissza véglegesen. Egy szezonban legfeljebb 5 nap lehet.
                </p>
              </InfoTip>
            </div>
            {listedDeletedDays.map(({ day: d, pending }) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-white p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-500 line-through">{formatDate(d.date)}</p>
                    <p className="text-xs text-gray-500">
                      {pending
                        ? "Mentéskor törlődik"
                        : (d as PickupDay).archivedOrderCount
                          ? `${(d as PickupDay).archivedOrderCount} törölt rendelés`
                          : "Nincs rendelése"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={value.pickupDays.length >= 5}
                    onClick={() => (pending ? restoreRemovedDay(d) : onChange({ ...value, pickupDays: [...value.pickupDays, { ...d, active: false }] }))}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
                    Visszaállítás
                  </button>
                </div>
            ))}
            </div>
           </DeletedDaysToggle>
          </div>
        )}
      </EditorSection>

      {dunavecse && (
        <EditorSection
          title="DUNAVECSE (Bács-Kiskun, technikai nap)"
          accent="pink"
          hint={
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
          }
        >
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3">
            <div className="min-w-[10rem] flex-1">
              <p className="truncate text-sm font-semibold text-gray-800">
                Vágási nap: {dunavecse.date ? formatDate(dunavecse.date) : "–"}
              </p>
              <p className="text-xs text-gray-500">Korlátlan kapacitás</p>
              <OrderStatsLine
                className="mt-1"
                orderCount={dunavecse.orderCount}
                reservedQuantity={dunavecse.reservedQuantity}
              />
            </div>

            {value.active && (
              <ActiveCheckbox
                active={value.dunavecseActive ?? dunavecse.active}
                onChange={() =>
                  onChange({ ...value, dunavecseActive: !(value.dunavecseActive ?? dunavecse.active) })
                }
              />
            )}
          </div>
        </EditorSection>
      )}

      <section
        className={`rounded-xl border border-l-4 border-gray-200 bg-white px-4 py-3 transition-colors ${ACCENTS.gray.bar}`}
      >
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-base font-semibold text-gray-800">Szezon aktiválása</span>
            <span className="block text-sm text-gray-500">
              Az aktív szezonra a vásárlók csak az előrendelési időablakon belül rendelhetnek. Egyszerre egy szezon
              lehet aktív: a korábban aktív szezon inaktívvá válik.
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              role="switch"
              checked={value.active}
              onChange={(e) => onChange({ ...value, active: e.target.checked })}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="h-7 w-12 rounded-full bg-gray-300 transition-colors peer-checked:bg-[rgb(67,133,45)] peer-focus-visible:ring-2 peer-focus-visible:ring-[rgb(67,133,45)] peer-focus-visible:ring-offset-2"
            />
            <span
              aria-hidden="true"
              className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
            />
          </span>
        </label>

        {newlyActivated && inactiveDayCount > 0 && (
          <Notice tone="warning" title="Az átvételi napok nincsenek bekapcsolva" className="mt-3">
            <p>
              A szezon aktiválása nem kapcsolja be automatikusan az átvételi napokat: azokat a napoknál az Aktív
              jelölővel külön kell aktiválni.
            </p>
            <p>
              Inaktív napok ({inactiveDayCount}): {inactiveDayNames.join(", ")}. Ezekre a vásárlók addig nem tudnak
              rendelni.
            </p>
          </Notice>
        )}

        {newlyActivated && inactiveDayCount === 0 && (
          <Notice tone="success" title="Minden átvételi nap aktív" className="mt-3" />
        )}
      </section>

      {liveConfirmMessage && (
        <Notice
          tone="warning"
          title="Élő rendelés tartozik a törölt naphoz"
          reveal
          actions={
            <>
              <button type="button" disabled={saving} onClick={onConfirmLive} className={noticeConfirmButtonClass}>
                {saving ? "Mentés…" : "Mentés megerősítéssel"}
              </button>
              <button type="button" disabled={saving} onClick={onDismissLive} className={noticeCancelButtonClass}>
                Mégse
              </button>
            </>
          }
        >
          <p>{liveConfirmMessage}</p>
          <p>
            A törölt nap rendelései is törlődnek: a vásárló nem kap róla e-mailt, és az előzményeiből is eltűnnek.
            Visszaállításkor visszakerülnek.
          </p>
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="A mentés nem sikerült" reveal>
          <p>{error}</p>
        </Notice>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mégse
        </button>
        <button
          disabled={saving || hasLimitProblem}
          title={hasLimitProblem ? "A limitek nem lehetnek kisebbek a már leadott rendeléseknél." : undefined}
          className="rounded-lg bg-[rgb(67,133,45)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
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
  // restoringKey: "season-<id>" - melyik szezon visszaállítása fut.
  const [showArchived, setShowArchived] = useState(false);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
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
      dunavecseActive: s.dunavecse?.active,
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
      else if (r.needsConfirmation) {
        // A szerver üzenete a napok felsorolása mellett a következményeket is
        // leírja; a panel alatt ugyanez külön szerepel, ezért itt csak a
        // napokat vesszük át (ha az üzenet formája eltér, a teljes üzenetet írjuk ki).
        const liveDates = /tartozik: (.+?)\.\s/.exec(r.error)?.[1];
        setLiveConfirmMessage(liveDates ? `Érintett napok: ${liveDates}.` : r.error);
      }
      else setError(r.error);
    } catch (e) {
      console.error("Szezon mentési hiba:", e);
      setError("A szezon mentése váratlan hiba miatt sikertelen.");
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

  const renderSeason = (s: Season) => {
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
      (s.dunavecse?.orderCount ?? 0);

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
                {s.year} {s.type}
              </span>
              <span
                className="mt-0.5 block min-h-4 truncate pl-7 text-xs font-normal text-gray-500"
                title={s.note || undefined}
              >
                {s.note}
              </span>
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
                deletedDays={s.deletedDays}
                liveConfirmMessage={liveConfirmMessage}
                onConfirmLive={() => save(true)}
                onDismissLive={() => setLiveConfirmMessage(null)}
                onChange={setForm}
                onSave={() => save()}
                onCancel={cancelSeasonEdit}
                saving={saving}
                error={error}
                dunavecse={s.dunavecse}
                savedActive={s.active}
              />
            ) : (
              <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <InfoCard
                    accent="green"
                    title="Árak"
                    rows={products.map((product): [string, React.ReactNode] => {
                      const price = s.prices?.find((entry) => entry.productId === product.id)?.price;
                      return [product.name, price === undefined ? "–" : `${formatCount(price)} Ft/kg`];
                    })}
                  />
                  <InfoCard
                    accent="blue"
                    title="Előrendelés"
                    rows={[
                      ["Kezdete", s.orderStart ? formatDate(s.orderStart) : "–"],
                      ["Vége", s.orderEnd ? formatDate(s.orderEnd) : "–"],
                      ["Súly", `${s.weightMin}–${s.weightMax} kg`],
                    ]}
                  />
                  <div className={`rounded-lg border border-l-[3px] border-gray-200 ${ACCENTS.purple.bar} bg-white p-3`}>
                    <SectionLabel accent="purple">Átvételi időpontok</SectionLabel>
                    <div className="mt-2 space-y-2">
                      <div className="rounded-md border border-gray-200 px-2.5 py-2">
                        <p className="text-xs font-semibold text-gray-700">Városi átvétel</p>
                        <dl className="mt-1 divide-y divide-gray-100">
                          <div className="flex items-baseline justify-between gap-3 py-1 first:pt-0 last:pb-0">
                            <dt className="text-sm text-gray-500">Kezdete</dt>
                            <dd className="text-sm font-semibold tabular-nums text-gray-900">{s.pickupTimeStart || "–"}</dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-3 py-1 first:pt-0 last:pb-0">
                            <dt className="text-sm text-gray-500">Vége</dt>
                            <dd className="text-sm font-semibold tabular-nums text-gray-900">{s.pickupTimeEnd || "–"}</dd>
                          </div>
                        </dl>
                      </div>
                      <div className="rounded-md border border-gray-200 px-2.5 py-2">
                        <p className="text-xs font-semibold text-gray-700">Tanyasi átvétel</p>
                        <dl className="mt-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-sm text-gray-500">Kezdete</dt>
                            <dd className="text-sm font-semibold tabular-nums text-gray-900">{s.localPickupTimeStart || "–"}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>

                {s.note && (
                  <div className={`rounded-lg border border-l-[3px] border-gray-200 ${ACCENTS.gray.bar} bg-white p-3`}>
                    <SectionLabel accent="gray">Megjegyzés</SectionLabel>
                    <p className="mt-1.5 whitespace-pre-line break-words text-sm text-gray-800">{s.note}</p>
                  </div>
                )}

                <div>
                  <SectionLabel accent="orange">Átvételi napok</SectionLabel>
                  <div className="mt-2 space-y-2">
                    {s.pickupDays.map((d) => (
                      <DayCard
                        key={d.date}
                        title={formatDate(d.date)}
                        status={s.active ? <StatusBadge active={d.active !== false} /> : null}
                        facts={[
                          ["Napi limit", `${formatCount(d.limit)} db`],
                          ["Kisebb méret limit", formatLimitUsage(d.smallSizeLimit, d.liveSmallQuantity)],
                          ["Nagyobb méret limit", formatLimitUsage(d.largeSizeLimit, d.liveLargeQuantity)],
                          ["Aktív rendelés", formatCount(d.orderCount ?? 0)],
                          ["Lefoglalt csirke", `${formatCount(d.reservedQuantity ?? 0)} db`],
                        ]}
                      />
                    ))}
                  </div>
                </div>

                {s.dunavecse && (
                  <div>
                    <div className="inline-flex items-center gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-pink-600">DUNAVECSE (Bács-Kiskun, technikai nap)</span>
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
                    </div>
                    <div className="mt-2">
                      <DayCard
                        accent="pink"
                        title={`Vágási nap: ${s.dunavecse.date ? formatDate(s.dunavecse.date) : "–"}`}
                        status={s.active ? <StatusBadge active={s.dunavecse.active} /> : null}
                        facts={[
                          ["Kapacitás", "Korlátlan"],
                          ["Aktív rendelés", formatCount(s.dunavecse.orderCount)],
                          ["Lefoglalt csirke", `${formatCount(s.dunavecse.reservedQuantity ?? 0)} db`],
                        ]}
                      />
                    </div>
                  </div>
                )}

                {s.deletedDays.length > 0 && (
                  <DeletedDaysToggle count={s.deletedDays.length}>
                    <div className="inline-flex items-center gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Törölt napok</span>
                      <InfoTip>
                        <p>Visszaállítani csak a szezon szerkesztésekor lehet.</p>
                        <p className="mt-1.5">
                          A törölt nap rendelései is törölve vannak: a vásárló nem kap róla e-mailt, és az
                          előzményeiből is eltűnnek. Visszaállításkor visszakerülnek. (Az inaktív nap
                          rendelései ezzel szemben megmaradnak.)
                        </p>
                      </InfoTip>
                    </div>
                    <div className="mt-2 space-y-2">
                      {s.deletedDays.map((d) => (
                        <DayCard
                          key={d.id}
                          muted
                          title={formatDate(d.date)}
                          status={<DeletedBadge />}
                          facts={[
                            ["Napi limit", `${formatCount(d.limit)} db`],
                            ["Kisebb méret limit", formatLimitUsage(d.smallSizeLimit, d.liveSmallQuantity)],
                            ["Nagyobb méret limit", formatLimitUsage(d.largeSizeLimit, d.liveLargeQuantity)],
                            ["Törölt rendelés", formatCount(d.archivedOrderCount ?? 0)],
                          ]}
                        />
                      ))}
                    </div>
                  </DeletedDaysToggle>
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
                    className="rounded-lg border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-gray-50"
                  >
                    Törlés
                  </button>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500">
                  <InformationCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <span>
                    A szezon bármikor törölhető. A törölt szezon a lap alján, a „Törölt szezonok” között
                    visszaállítható (inaktívként); a napjainak rendelései is törlődnek a vásárlók értesítése
                    nélkül (az előzményeikből eltűnnek), a visszaállításkor visszakerülnek.
                  </span>
                </div>

                {confirmDeleteId === s.id && (
                  <Notice
                    tone="warning"
                    title="Biztosan törli a szezont?"
                    reveal
                    actions={
                      <>
                        <button
                          type="button"
                          disabled={deletingId === s.id}
                          onClick={() => remove(s.id)}
                          className={noticeConfirmButtonClass}
                        >
                          {deletingId === s.id ? "Törlés…" : "Törlés megerősítése"}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === s.id}
                          onClick={() => setConfirmDeleteId(null)}
                          className={noticeCancelButtonClass}
                        >
                          Mégse
                        </button>
                      </>
                    }
                  >
                    <p>
                      {liveOrders > 0 ? `A szezonhoz ${liveOrders} élő rendelés tartozik. ` : ""}
                      {s.active ? "A szezon jelenleg aktív. " : ""}
                      A szezon az összes átvételi napjával együtt törlődik, a napok rendelései is: a vásárló nem kap
                      róla e-mailt, és az előzményeiből is eltűnnek. Visszaállításkor visszakerülnek.
                    </p>
                  </Notice>
                )}

                {confirmDeleteId === s.id && deleteError && (
                  <Notice tone="error" title="A törlés nem sikerült" className="mt-2" reveal>
                    <p>{deleteError}</p>
                  </Notice>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-4">
      {open ? (
        <section className={cardHighlightClass(true)}>
          <h2 className="font-semibold text-gray-800">Új szezon</h2>
          <Editor value={form} products={products} onChange={setForm} onSave={() => save()} onCancel={closeEditor} saving={saving} error={error} />
        </section>
      ) : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => (setForm(blank(products)), setExpandedId(null), setEditingId(null), setOpen(true))}
            className="rounded-lg border-2 border-[rgb(138,115,85)] bg-white px-6 py-2 text-base font-semibold text-[rgb(138,115,85)] transition hover:bg-[rgb(138,115,85)] hover:text-white"
          >
            + Új szezon hozzáadása
          </button>
        </div>
      )}

      {seasons.some((s) => !s.archived && s.active) && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-800">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200">
              <CheckBadgeIcon aria-hidden="true" className="h-5 w-5 text-gray-500" />
            </span>
            Aktív szezon
          </h2>
          <div className="grid gap-3">{seasons.filter((s) => !s.archived && s.active).map(renderSeason)}</div>
        </section>
      )}

      {seasons.some((s) => !s.archived && !s.active) && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-800">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200">
              <ClockIcon aria-hidden="true" className="h-5 w-5 text-gray-500" />
            </span>
            Korábbi szezonok
          </h2>
          <div className="grid gap-3">{seasons.filter((s) => !s.archived && !s.active).map(renderSeason)}</div>
        </section>
      )}

      {seasons.some((s) => s.archived) && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-800">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200">
              <TrashIcon aria-hidden="true" className="h-5 w-5 text-gray-500" />
            </span>
            Törölt szezonok
          </h2>
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {showArchived ? "Törölt szezonok elrejtése" : "Törölt szezonok megjelenítése"} (
            {seasons.filter((s) => s.archived).length})
          </button>
          {showArchived && (
          <div className="mt-2">
          <div className="grid gap-3">
            {seasons
              .filter((s) => s.archived)
              .map((s) => (
                <article key={s.id} className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
                  <h3>
                    <button
                      type="button"
                      onClick={() => toggleExpand(s.id)}
                      aria-expanded={expandedId === s.id}
                      aria-controls={`season-${s.id}`}
                      className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                    >
                      <span className="min-w-0 max-w-full">
                        <span className="flex items-center gap-2 font-semibold text-gray-500">
                          <span className="line-through">
                            {s.year} {s.type}
                          </span>
                        </span>
                        <span
                          className="mt-0.5 block min-h-4 truncate pl-7 text-xs font-normal text-gray-500"
                          title={s.note || undefined}
                        >
                          {s.note}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatChip
                          value={s.archivedStats.dunavecse ? `${s.archivedStats.days} + ${s.archivedStats.dunavecse.days}` : s.archivedStats.days}
                          label="nap"
                        />
                        <StatChip
                          value={s.archivedStats.dunavecse ? `${s.archivedStats.orders} + ${s.archivedStats.dunavecse.orders}` : s.archivedStats.orders}
                          label="rendelés"
                        />
                        <StatChip
                          value={s.archivedStats.dunavecse ? `${s.archivedStats.quantity} db + ${s.archivedStats.dunavecse.quantity} db` : s.archivedStats.quantity}
                          label={s.archivedStats.dunavecse ? "csirke" : "db csirke"}
                        />
                        <DeletedBadge />
                        <ChevronDownIcon
                          aria-hidden="true"
                          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${expandedId === s.id ? "rotate-180" : ""}`}
                        />
                      </span>
                    </button>
                  </h3>

                  {expandedId === s.id && (
                    <div id={`season-${s.id}`} className="mt-4 border-t border-gray-100 pt-4">
                      <div className="flex justify-center">
                        <button
                          type="button"
                          disabled={restoringKey !== null}
                          onClick={() => restore(`season-${s.id}`, () => restoreSeason(s.id))}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                        >
                          <ArrowUturnLeftIcon aria-hidden="true" className="h-4 w-4" />
                          {restoringKey === `season-${s.id}` ? "Visszaállítás…" : "Szezon visszaállítása"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A visszaállított szezon és napjai inaktívként kerülnek vissza, a napok rendelései automatikusan visszakerülnek.
            Aktiválni a szezon szerkesztésénél lehet.
          </p>
          {restoreError && (
            <Notice tone="error" title="A visszaállítás nem sikerült" className="mt-2" reveal>
              <p>{restoreError}</p>
            </Notice>
          )}
          </div>
          )}
        </section>
      )}
    </div>
  );
}
