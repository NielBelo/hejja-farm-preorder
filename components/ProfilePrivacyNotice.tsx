"use client";

import { useState } from "react";
import InfoModal from "@/components/InfoModal";
import PrivacyPolicyContent from "@/components/PrivacyPolicyContent";

export default function ProfilePrivacyNotice() {
    const [privacyModalOpen, setPrivacyModalOpen] = useState(false);

    return (
        <>
            <p className="text-lg leading-7 text-center text-gray-600">
                <span className="font-medium text-gray-700">
                    Az itt megjelenő személyes és kapcsolattartási adatokat a
                    Héjja Ökofarm a felhasználói fiók és az előrendelések
                    kezeléséhez, valamint kapcsolattartáshoz használja.
                </span>{" "}
                Az adatok ezen az oldalon bármikor áttekinthetők és
                módosíthatók. További részletek az{" "}
                <button
                    type="button"
                    onClick={() => setPrivacyModalOpen(true)}
                    className="font-semibold text-[rgb(72,93,162)] underline underline-offset-2 hover:text-[rgb(55,75,150)]"
                >
                    Adatkezelési tájékoztató
                </button>
                ban olvashatók.
            </p>

            {privacyModalOpen && (
                <InfoModal
                    title="Adatkezelési tájékoztató"
                    onClose={() => setPrivacyModalOpen(false)}
                >
                    <PrivacyPolicyContent />
                </InfoModal>
            )}
        </>
    );
}
