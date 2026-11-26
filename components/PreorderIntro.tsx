import Image from "next/image";
import type { ReactNode } from "react";

// A kép megjelenített (bruttó) magassága pixelben: ez határozza meg, mennyi
// marad a képből. A kép a szélességhez igazodik, a felesleg levágódik.
const IMAGE_HEIGHT_PX = 250;
// A kép szélessége a szövegoszlop szélességének százalékában (középre igazítva).
const IMAGE_WIDTH_PERCENT = 100;
// A levágott rész felosztása fent és lent (csak az arány számít: 0.4 / 0.5
// ugyanaz, mint 40 / 50): ez adja, hogy a kép melyik sávja látszik.
const CROP_TOP = 0.35;
const CROP_BOTTOM = 0.5;

export default function PreorderIntro({ imageUrl, children }: {
    imageUrl?: string | null;
    children: ReactNode;
}) {
    return (
        // A fehér doboz a kép mögött, annak felső sarkától indul, ezért a kép
        // átlátszó alsó sávja a doboz fehérjébe olvad.
        <div className="mb-6 rounded-xl bg-white/70">
            {imageUrl && (
                // Az alsó szél átlátszóvá halványul (a doboz fehérje látszik át).
                <div
                    className="relative mx-auto overflow-hidden rounded-xl"
                    style={{ height: IMAGE_HEIGHT_PX, maxWidth: `${IMAGE_WIDTH_PERCENT}%` }}
                >
                    <Image
                        src={imageUrl}
                        alt="Csirkék a Héjja-farmon"
                        fill
                        sizes="(min-width: 1024px) 1024px, 100vw"
                        style={{ objectPosition: `50% ${(CROP_TOP / (CROP_TOP + CROP_BOTTOM)) * 100}%` }}
                        className="object-cover [mask-image:linear-gradient(to_bottom,black_70%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
                        preload
                    />
                </div>
            )}
            <div className={`px-6 pb-4 ${imageUrl ? "pt-2" : "pt-4"}`}>
                {children}
            </div>
        </div>
    );
}
