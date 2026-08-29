"use client";

import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import { memo, useEffect, useRef, useState } from "react";
import {
    CheckIcon,
    EnvelopeIcon,
    LockClosedIcon,
    MapIcon,
    MapPinIcon,
    PencilSquareIcon,
    PhoneIcon,
    XMarkIcon,
    ChevronDownIcon,
} from "@heroicons/react/24/outline";

type Profile = {
    first_name: string;
    last_name: string;
    phone: string;
    county: string | null;
    city: string;
};

type ProfileForm = Profile & {
    email: string;
};

type SaveResult = {
    profileSaved: boolean;
    emailChangeRequested: boolean;
    passwordChanged: boolean;
};

const counties = [
    "Bács-Kiskun",
    "Baranya",
    "Békés",
    "Borsod-Abaúj-Zemplén",
    "Budapest",
    "Csongrád-Csanád",
    "Fejér",
    "Győr-Moson-Sopron",
    "Hajdú-Bihar",
    "Heves",
    "Jász-Nagykun-Szolnok",
    "Komárom-Esztergom",
    "Nógrád",
    "Pest",
    "Somogy",
    "Szabolcs-Szatmár-Bereg",
    "Tolna",
    "Vas",
    "Veszprém",
    "Zala",
];

function formatPhoneInput(value: string): string {
    let digits = value.replace(/\D/g, "");

    if (digits.startsWith("06")) {
        digits = "36" + digits.slice(2);
    }

    if (!digits.startsWith("36")) {
        digits = "36" + digits;
    }

    digits = digits.slice(0, 11);

    const prefix = digits.slice(2, 4);
    const first = digits.slice(4, 7);
    const second = digits.slice(7, 11);

    let result = "+36";

    if (prefix) result += ` ${prefix}`;
    if (first) result += ` ${first}`;
    if (second) result += ` ${second}`;

    return result;
}

function normalizeHungarianPhone(value: string): string | null {
    const digits = value.replace(/\D/g, "");

    if (!/^36\d{9}$/.test(digits)) {
        return null;
    }

    return `+${digits}`;
}

function formatStoredPhone(value: string): string {
    if (!value) {
        return "+36";
    }

    return formatPhoneInput(value);
}

function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function ProfileEditor({
    userId,
    email,
    profile,
}: {
    userId: string;
    email: string;
    profile: Profile;
}) {
    const supabase = createClient();

    const initialProfile: ProfileForm = {
        ...profile,
        email,
        phone: formatStoredPhone(profile.phone),
    };

    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [form, setForm] = useState<ProfileForm>(initialProfile);
    const [savedProfile, setSavedProfile] =
        useState<ProfileForm>(initialProfile);

    const [isPasswordEditing, setIsPasswordEditing] = useState(false);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [saveError, setSaveError] = useState("");
    const [saveSuccess, setSaveSuccess] = useState("");

    const normalizedPhone = normalizeHungarianPhone(form.phone);

    const requiredProfileFieldsValid =
        form.last_name.trim() !== "" &&
        form.first_name.trim() !== "" &&
        isValidEmail(form.email) &&
        normalizedPhone !== null &&
        form.county !== null &&
        form.county.trim() !== "";

    const passwordValid =
        !isPasswordEditing ||
        (
            newPassword.length >= 6 &&
            newPassword === confirmPassword
        );

    const canSave =
        requiredProfileFieldsValid &&
        passwordValid &&
        !isSaving;

    const handleChange = (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) => {
        const { name, value } = e.target;

        if (name === "phone") {
            setForm((prev) => ({
                ...prev,
                phone: formatPhoneInput(value),
            }));

            return;
        }

        setForm((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleStartEditing = () => {
        setSaveError("");
        setSaveSuccess("");

        setForm({
            ...savedProfile,
            phone: formatStoredPhone(savedProfile.phone),
        });

        setNewPassword("");
        setConfirmPassword("");
        setIsPasswordEditing(false);
        setIsEditing(true);
    };

    const handleCancel = () => {
        setForm(savedProfile);

        setNewPassword("");
        setConfirmPassword("");
        setIsPasswordEditing(false);

        setSaveError("");
        setSaveSuccess("");

        setIsEditing(false);
    };

    const handleStartPasswordEditing = () => {
        setNewPassword("");
        setConfirmPassword("");
        setIsPasswordEditing(true);
    };

    const handleSave = async () => {
        setSaveError("");
        setSaveSuccess("");

        const phone = normalizeHungarianPhone(form.phone);

        if (
            !form.last_name.trim() ||
            !form.first_name.trim() ||
            !form.email.trim() ||
            !form.county?.trim()
        ) {
            setSaveError(
                "Kérjük, töltse ki az összes kötelező mezőt."
            );
            return;
        }

        if (!isValidEmail(form.email)) {
            setSaveError(
                "Kérjük, adjon meg érvényes e-mail címet."
            );
            return;
        }

        if (!phone) {
            setSaveError(
                "Kérjük, adjon meg érvényes magyar telefonszámot."
            );
            return;
        }

        if (isPasswordEditing) {
            if (newPassword.length < 6) {
                setSaveError(
                    "Az új jelszónak legalább 6 karakter hosszúnak kell lennie."
                );
                return;
            }

            if (newPassword !== confirmPassword) {
                setSaveError(
                    "A két megadott jelszó nem egyezik."
                );
                return;
            }
        }

        setIsSaving(true);

        const result: SaveResult = {
            profileSaved: false,
            emailChangeRequested: false,
            passwordChanged: false,
        };

        const errors: string[] = [];

        /*
         * 1. SZEMÉLYES PROFILADATOK
         */
        const { error: profileError } = await supabase
            .from("profiles")
            .update({
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim(),
                phone,
                county: form.county,
                city: form.city.trim(),
            })
            .eq("id", userId);

        if (profileError) {
            console.error(
                "Profil mentési hiba:",
                profileError
            );

            errors.push(
                "A személyes adatok mentése sikertelen."
            );
        } else {
            result.profileSaved = true;
        }

        /*
         * 2. E-MAIL CÍM
         *
         * Csak akkor indítunk Auth-módosítást,
         * ha ténylegesen változott.
         */
        const emailChanged =
            form.email.trim().toLowerCase() !==
            savedProfile.email.trim().toLowerCase();

        if (emailChanged) {
            const { error: emailError } =
                await supabase.auth.updateUser({
                    email: form.email.trim(),
                });

            if (emailError) {
                console.error(
                    "E-mail módosítási hiba:",
                    emailError
                );

                errors.push(
                    "Az e-mail cím módosításának elindítása sikertelen."
                );
            } else {
                result.emailChangeRequested = true;
            }
        }

        /*
         * 3. JELSZÓ
         *
         * Csak akkor módosítjuk, ha a felhasználó
         * megnyitotta a jelszó módosítását.
         */
        if (isPasswordEditing) {
            const { error: passwordError } =
                await supabase.auth.updateUser({
                    password: newPassword,
                });

            if (passwordError) {
                console.error(
                    "Jelszó módosítási hiba:",
                    passwordError
                );

                errors.push(
                    "A jelszó módosítása sikertelen."
                );
            } else {
                result.passwordChanged = true;
            }
        }

        setIsSaving(false);

        /*
         * Ha a profiladatok mentése sikerült,
         * azokat már tekinthetjük az új mentett állapotnak.
         *
         * Az e-mail viszont addig NEM lesz a megjelenített
         * aktuális e-mail, amíg a Supabase megerősítési
         * folyamata ténylegesen le nem zárul.
         */
        if (result.profileSaved) {
            setSavedProfile((prev) => ({
                ...prev,
                first_name: form.first_name.trim(),
                last_name: form.last_name.trim(),
                phone: formatPhoneInput(phone),
                county: form.county,
                city: form.city.trim(),
            }));
        }

        /*
         * Jelszó mezők biztonságos ürítése.
         */
        if (result.passwordChanged) {
            setNewPassword("");
            setConfirmPassword("");
            setIsPasswordEditing(false);
        }

        /*
         * Ha bármi hibára futott, szerkesztési módban
         * maradunk, hogy a felhasználó lássa és javíthassa.
         */
        if (errors.length > 0) {
            setSaveError(errors.join(" "));
            return;
        }

        /*
         * Teljes siker.
         */
        if (result.emailChangeRequested) {
            setSaveSuccess(
                `A személyes adatok mentése sikerült. ` +
                `Az új e-mail cím (${form.email.trim()}) ` +
                `megerősítéséhez levelet küldtünk.`
            );
        } else if (result.passwordChanged) {
            setSaveSuccess(
                "A személyes adatok és a jelszó módosítása sikerült."
            );
        } else {
            setSaveSuccess(
                "A személyes adatok módosítása sikerült."
            );
        }

        /*
         * Az Authban még a régi e-mail az aktuális,
         * ezért a read-only kártyán azt hagyjuk.
         */
        setForm((prev) => ({
            ...prev,
            email: savedProfile.email,
        }));

        setIsEditing(false);
    };

    return (
        <>
            {/* VÁSÁRLÓI ADATLAP */}
            <div
                className="
                    relative overflow-hidden
                    rounded-2xl border border-gray-200
                    bg-white shadow-md
                "
            >
                <SecurityPattern />

                {/* TELJES KÁRTYATARTALOM */}
                <div className="relative z-10 p-6 sm:p-8">

                    {/* FEJLÉC */}
                    <div
                        className="
                            relative z-20
                            -mx-6 -mt-6 mb-7
                            flex flex-col gap-4
                            bg-[#F0FAEE]
                            px-6 py-5
                            sm:-mx-8 sm:-mt-8 sm:px-8
                            sm:flex-row
                            sm:items-center
                            sm:justify-between
                        "
                    >
                        <div className="flex items-center gap-4">

                            {/* PROFIL IKON */}
                            <div
                                className="
                                    flex h-16 w-16 shrink-0
                                    items-center justify-center
                                    rounded-xl
                                    border-2
                                    border-2 border-gray-400
                                    bg-white
                                "
                            >
                                <svg
                                    viewBox="0 0 64 64"
                                    className="h-11 w-11 text-gray-600"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                >
                                    <circle
                                        cx="32"
                                        cy="21"
                                        r="10"
                                    />

                                    <path
                                        d="
                                            M12 54
                                            C14 42 21 36 32 36
                                            C43 36 50 42 52 54
                                        "
                                    />
                                </svg>
                            </div>

                            <div>
                                <div
                                    className="
                                        text-xl font-semibold
                                        tracking-wide text-gray-800
                                    "
                                >
                                    {savedProfile.last_name.toUpperCase()}{" "}
                                    {savedProfile.first_name.toUpperCase()}
                                </div>

                                <div
                                    className="
                                        mt-1 text-xs font-medium
                                        uppercase tracking-[0.18em]
                                        text-gray-400
                                    "
                                >
                                    Héjja-Farm vásárlói adatlap
                                </div>
                            </div>
                        </div>

                        {!isEditing && (
                            <button
                                type="button"
                                onClick={handleStartEditing}
                                className="
                                    flex items-center
                                    justify-center gap-2
                                    rounded-lg border
                                    border-[rgb(49,171,2)]/40
                                    bg-white px-4 py-2
                                    text-sm font-medium
                                    text-[rgb(49,171,2)]
                                    transition
                                    hover:bg-[#F0FAEE]
                                "
                            >
                                <PencilSquareIcon className="h-4 w-4" />
                                Szerkesztés
                            </button>
                        )}
                    </div>

                    {/* VISSZAJELZÉS */}
                    {!isEditing && saveSuccess && (
                        <div
                            className="
                                mb-6 rounded-lg
                                border border-green-200
                                bg-green-50 px-4 py-3
                                text-sm text-green-700
                            "
                        >
                            {saveSuccess}
                        </div>
                    )}

                    {/* PROFILADATOK */}
                    {!isEditing ? (
                        <ReadOnlyProfile
                            profile={savedProfile}
                            userId={userId}
                        />
                    ) : (
                        <EditProfile
                            form={form}
                            handleChange={handleChange}
                            isPasswordEditing={isPasswordEditing}
                            newPassword={newPassword}
                            confirmPassword={confirmPassword}
                            onStartPasswordEditing={
                                handleStartPasswordEditing
                            }
                            onNewPasswordChange={
                                setNewPassword
                            }
                            onConfirmPasswordChange={
                                setConfirmPassword
                            }
                        />
                    )}

                    {/* HIBA */}
                    {isEditing && saveError && (
                        <div
                            className="
                                mt-6 rounded-lg
                                border border-red-200
                                bg-red-50 px-4 py-3
                                text-sm text-red-600
                            "
                        >
                            {saveError}
                        </div>
                    )}

                    {/* SZERKESZTÉS GOMBJAI */}
                    {isEditing && (
                        <div
                            className="
                                mt-7 flex justify-end gap-3
                                pt-5
                            "
                        >
                            <button
                                type="button"
                                onClick={handleCancel}
                                disabled={isSaving}
                                className="
                                    flex items-center gap-2
                                    rounded-lg
                                    border border-gray-300
                                    bg-white px-5 py-2
                                    text-sm font-medium
                                    text-gray-600
                                    transition hover:bg-gray-50
                                    disabled:opacity-50
                                "
                            >
                                <XMarkIcon className="h-4 w-4" />
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave}
                                className="
    flex items-center gap-2
    rounded-lg
    bg-[rgb(49,171,2)]
    px-5 py-2
    text-sm font-medium
    text-white
    transition
    hover:opacity-90
    disabled:cursor-not-allowed
    disabled:bg-[#F0FAEE]
    disabled:text-[rgb(49,171,2)]/50
    disabled:opacity-100
"
                            >
                                <CheckIcon className="h-4 w-4" />

                                {isSaving
                                    ? "Mentés..."
                                    : "Mentés"}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

function ReadOnlyProfile({
    profile,
    userId,
}: {
    profile: ProfileForm;
    userId: string;
}) {
    return (
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">

            {/* 1. SOR */}
            <InfoField
                icon={<EnvelopeIcon className="h-5 w-5" />}
                label="E-mail cím"
                value={profile.email}
            />

            <InfoField
                icon={<MapIcon className="h-5 w-5" />}
                label="Vármegye"
                value={profile.county ?? "—"}
            />

            {/* 2. SOR */}
            <InfoField
                icon={<PhoneIcon className="h-5 w-5" />}
                label="Telefonszám"
                value={formatStoredPhone(profile.phone)}
            />

            <InfoField
                icon={<MapPinIcon className="h-5 w-5" />}
                label="Település"
                value={profile.city.trim() || "—"}
            />

            {/* 3. SOR */}
            <SecurityBarcode userId={userId} />

            <FarmVerificationMark />
        </div>
    );
}

function InfoField({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="pb-4">
            <div className="mb-2 flex items-center gap-2">
                <span className="text-[rgb(49,171,2)]">
                    {icon}
                </span>

                <span
                    className="
                        text-xs font-medium uppercase
                        tracking-wider text-gray-400
                    "
                >
                    {label}
                </span>
            </div>

            <div className="pl-7 text-base font-medium text-gray-800">
                {value}
            </div>
        </div>
    );
}

function EditProfile({
    form,
    handleChange,
    isPasswordEditing,
    newPassword,
    confirmPassword,
    onStartPasswordEditing,
    onNewPasswordChange,
    onConfirmPasswordChange,
}: {
    form: ProfileForm;
    handleChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
    ) => void;
    isPasswordEditing: boolean;
    newPassword: string;
    confirmPassword: string;
    onStartPasswordEditing: () => void;
    onNewPasswordChange: (value: string) => void;
    onConfirmPasswordChange: (value: string) => void;
}) {
    return (
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">

            {/* 1. SOR */}
            <ProfileInput
                label="Vezetéknév"
                name="last_name"
                value={form.last_name}
                onChange={handleChange}
                required
            />

            <ProfileInput
                label="Keresztnév"
                name="first_name"
                value={form.first_name}
                onChange={handleChange}
                required
            />

            {/* 2. SOR */}
            <div>
                <ProfileInput
                    label="E-mail cím"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    type="email"
                    inputMode="email"
                    required
                />

                <div className="mt-1.5 text-xs leading-relaxed text-gray-400">
                    Módosítás esetén megerősítő e-mailt küldünk
                    az új címre.
                </div>
            </div>

            <CountySelect
                value={form.county ?? ""}
                onChange={(county) =>
                    handleChange({
                        target: {
                            name: "county",
                            value: county,
                        },
                    } as React.ChangeEvent<HTMLSelectElement>)
                }
            />

            {/* 3. SOR */}
            <ProfileInput
                label="Telefonszám"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                type="tel"
                inputMode="tel"
                placeholder="+36 30 123 4567"
                required
            />

            <ProfileInput
                label="Település"
                name="city"
                value={form.city}
                onChange={handleChange}
            />

            {/* JELSZÓ */}
            <div className="sm:col-span-2">
                {!isPasswordEditing ? (
                    <button
                        type="button"
                        onClick={onStartPasswordEditing}
                        className="
                            flex items-center gap-2
                            rounded-lg
                            border border-gray-200
                            bg-white px-3.5 py-2.5
                            text-sm font-medium
                            text-gray-600
                            transition
                            hover:border-[rgb(49,171,2)]/30
                            hover:bg-[#F0FAEE]
                            hover:text-[rgb(49,171,2)]
                        "
                    >
                        <LockClosedIcon className="h-4 w-4" />
                        Jelszó módosítása
                    </button>
                ) : (
                    <div
                        className="
                            rounded-xl
                            border border-gray-200
                            bg-white/80 p-4
                        "
                    >
                        <div className="mb-4 flex items-center gap-2">
                            <LockClosedIcon
                                className="
                                    h-5 w-5
                                    text-[rgb(49,171,2)]
                                "
                            />

                            <div>
                                <div
                                    className="
                                        text-sm font-medium
                                        text-gray-700
                                    "
                                >
                                    Jelszó módosítása
                                </div>

                                <div className="text-xs text-gray-400">
                                    Az új jelszó legalább 6 karakter legyen.
                                </div>
                            </div>
                        </div>

                        <div
                            className="
                                grid gap-4
                                sm:grid-cols-2
                            "
                        >
                            <PasswordInput
                                label="Új jelszó"
                                value={newPassword}
                                onChange={onNewPasswordChange}
                            />

                            <PasswordInput
                                label="Új jelszó ismét"
                                value={confirmPassword}
                                onChange={onConfirmPasswordChange}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function CountySelect({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    const handleSelect = (county: string) => {
        onChange(county);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className="relative">
            <FieldLabel required>
                Vármegye
            </FieldLabel>

            {/* KIVÁLASZTÓ MEZŐ */}
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className={`
                    flex w-full items-center justify-between
                    rounded-lg border
                    bg-white px-3 py-2.5
                    text-left text-gray-800
                    outline-none transition
                    ${
                        isOpen
                            ? "border-[rgb(49,171,2)] ring-2 ring-[rgb(49,171,2)]/10"
                            : "border-gray-300"
                    }
                `}
            >
                <span
                    className={
                        value
                            ? "text-gray-800"
                            : "text-gray-400"
                    }
                >
                    {value || "Válasszon vármegyét"}
                </span>

                <ChevronDownIcon
                    className={`
                        h-4 w-4 shrink-0
                        text-gray-400
                        transition-transform duration-200
                        ${isOpen ? "rotate-180" : ""}
                    `}
                />
            </button>

            {/* LENYÍLÓ LISTA */}
            {isOpen && (
                <div
                    className="
                        absolute left-0 right-0 z-40
                        mt-1.5
                        overflow-hidden
                        rounded-xl
                        border border-gray-200
                        bg-white
                        shadow-lg
                    "
                >
                    <div
                        role="listbox"
                        className="
                            max-h-64
                            overflow-y-auto
                            p-1.5
                        "
                    >
                        {counties.map((county) => {
                            const isSelected = county === value;

                            return (
                                <button
                                    key={county}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() =>
                                        handleSelect(county)
                                    }
                                    className={`
                                        flex w-full
                                        items-center justify-between
                                        rounded-lg
                                        px-3 py-2.5
                                        text-left text-sm
                                        text-gray-800
                                        transition-colors
                                        hover:bg-[#F0FAEE]
                                        ${
                                            isSelected
                                                ? "bg-[#F0FAEE] font-medium"
                                                : "bg-white"
                                        }
                                    `}
                                >
                                    <span>
                                        {county}
                                    </span>

                                    {isSelected && (
                                        <CheckIcon
                                            className="
                                                h-4 w-4 shrink-0
                                                text-[rgb(49,171,2)]
                                            "
                                        />
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function ProfileInput({
    label,
    name,
    value,
    onChange,
    type = "text",
    inputMode,
    placeholder,
    required = false,
}: {
    label: string;
    name: string;
    value: string;
    onChange: (
        e: React.ChangeEvent<HTMLInputElement>
    ) => void;
    type?: React.HTMLInputTypeAttribute;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    placeholder?: string;
    required?: boolean;
}) {
    return (
        <div>
            <FieldLabel required={required}>
                {label}
            </FieldLabel>

            <input
                type={type}
                inputMode={inputMode}
                name={name}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                required={required}
                className="
                    w-full rounded-lg
                    border border-gray-300
                    bg-white px-3 py-2.5
                    text-gray-800 outline-none
                    transition
                    placeholder:text-gray-300
                    focus:border-[rgb(49,171,2)]
                    focus:ring-2
                    focus:ring-[rgb(49,171,2)]/10
                "
            />
        </div>
    );
}

function PasswordInput({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div>
            <FieldLabel required>
                {label}
            </FieldLabel>

            <input
                type="password"
                value={value}
                onChange={(e) =>
                    onChange(e.target.value)
                }
                autoComplete="new-password"
                className="
                    w-full rounded-lg
                    border border-gray-300
                    bg-white px-3 py-2.5
                    text-gray-800 outline-none
                    transition
                    focus:border-[rgb(49,171,2)]
                    focus:ring-2
                    focus:ring-[rgb(49,171,2)]/10
                "
            />
        </div>
    );
}

function FieldLabel({
    children,
    required = false,
}: {
    children: React.ReactNode;
    required?: boolean;
}) {
    return (
        <label
            className="
                mb-1.5 block
                text-xs font-medium
                uppercase tracking-wider
                text-gray-400
            "
        >
            {children}

            {required && (
                <span className="ml-1 text-red-500">
                    *
                </span>
            )}
        </label>
    );
}

function SecurityBarcode({
    userId,
}: {
    userId: string;
}) {
    const bars = Array.from(
        { length: 28 },
        (_, index) => {
            const char =
                userId.charCodeAt(
                    index % userId.length
                );

            return {
                width:
                    ((char + index) % 3) + 1,
            };
        }
    );

    return (
        <div className="pb-4">

            {/* FEJLÉC */}
            <div className="mb-2 flex items-center gap-2">
                <span className="text-[rgb(49,171,2)]">
                    <LockClosedIcon className="h-5 w-5" />
                </span>

                <span
                    className="
                        text-xs font-medium uppercase
                        tracking-wider text-gray-400
                    "
                >
                    Jelszó
                </span>
            </div>

            <div className="pl-7">

                <div className="mb-2 text-xs text-gray-400">
                    A jelszó biztonsági okból nem jeleníthető meg.
                </div>

                {/* EGYENES VONALKÓD */}
                <div
                    className="
                        flex h-8 items-end
                        gap-[2px] opacity-40
                    "
                    aria-hidden="true"
                >
                    {bars.map((bar, index) => (
                        <span
                            key={index}
                            className="block bg-gray-700"
                            style={{
                                width: `${bar.width}px`,
                                height: "30px",
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function FarmVerificationMark() {
    return (
        <div
            className="
                flex items-end justify-start
                pb-4
                sm:justify-end
            "
        >
            <div
                className="
                    flex items-center gap-2
                    rounded-lg
                    border border-[rgb(49,171,2)]/20
                    bg-white/85
                    px-2.5 py-2
                "
            >
                <Image
                    src="/images/logo2.png"
                    alt="Héjja Ökofarm"
                    width={30}
                    height={30}
                    className="
                        h-[30px] w-[30px]
                        shrink-0 object-contain
                    "
                />

                <div>
                    <div
                        className="
                            text-[11px] font-semibold
                            uppercase tracking-[0.12em]
                            text-gray-700
                        "
                    >
                        Héjja-Farm
                    </div>

                    <div
                        className="
                            mt-0.5 flex items-center gap-1
                            text-[7px] font-medium
                            uppercase tracking-[0.12em]
                            text-[rgb(49,171,2)]
                        "
                    >
                        <CheckIcon className="h-2.5 w-2.5" />
                        Hitelesítve
                    </div>
                </div>
            </div>
        </div>
    );
}

const SecurityPattern = memo(function SecurityPattern() {
    return (
        <svg
            className="
                pointer-events-none
                absolute inset-0
                z-0 h-full w-full
                text-[rgb(49,171,2)]
                opacity-[0.09]
            "
            viewBox="0 0 1000 500"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
        >
            {Array.from({ length: 72 }).map(
                (_, index) => {
                    const y =
                        -10 + index * 7.3;

                    return (
                        <path
                            key={index}
                            d={`
                                M -20 ${y}
                                C -10 ${y - 5}, 0 ${y - 5}, 10 ${y}
                                S 30 ${y + 5}, 40 ${y}
                                S 60 ${y - 5}, 70 ${y}
                                S 90 ${y + 5}, 100 ${y}
                                S 120 ${y - 5}, 130 ${y}
                                S 150 ${y + 5}, 160 ${y}
                                S 180 ${y - 5}, 190 ${y}
                                S 210 ${y + 5}, 220 ${y}
                                S 240 ${y - 5}, 250 ${y}
                                S 270 ${y + 5}, 280 ${y}
                                S 300 ${y - 5}, 310 ${y}
                                S 330 ${y + 5}, 340 ${y}
                                S 360 ${y - 5}, 370 ${y}
                                S 390 ${y + 5}, 400 ${y}
                                S 420 ${y - 5}, 430 ${y}
                                S 450 ${y + 5}, 460 ${y}
                                S 480 ${y - 5}, 490 ${y}
                                S 510 ${y + 5}, 520 ${y}
                                S 540 ${y - 5}, 550 ${y}
                                S 570 ${y + 5}, 580 ${y}
                                S 600 ${y - 5}, 610 ${y}
                                S 630 ${y + 5}, 640 ${y}
                                S 660 ${y - 5}, 670 ${y}
                                S 690 ${y + 5}, 700 ${y}
                                S 720 ${y - 5}, 730 ${y}
                                S 750 ${y + 5}, 760 ${y}
                                S 780 ${y - 5}, 790 ${y}
                                S 810 ${y + 5}, 820 ${y}
                                S 840 ${y - 5}, 850 ${y}
                                S 870 ${y + 5}, 880 ${y}
                                S 900 ${y - 5}, 910 ${y}
                                S 930 ${y + 5}, 940 ${y}
                                S 960 ${y - 5}, 970 ${y}
                                S 990 ${y + 5}, 1020 ${y}
                            `}
                            stroke="currentColor"
                            strokeWidth="0.75"
                            strokeLinecap="round"
                        />
                    );
                }
            )}
        </svg>
    );
});