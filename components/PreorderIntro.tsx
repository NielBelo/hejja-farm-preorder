"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function PreorderIntro({ imageUrl, children }: {
    imageUrl?: string | null;
    children: ReactNode;
}) {
    const textRef = useRef<HTMLDivElement>(null);
    // Széles nézeten a kép magassága a mellette lévő szöveg magassága; a
    // szélessége az arányból adódik. Keskeny nézeten (egymás alatt) a kép a
    // teljes szélességet kitölti, a magasság nincs rögzítve.
    const [textHeight, setTextHeight] = useState<number | null>(null);

    useEffect(() => {
        const text = textRef.current;
        if (!text) return;

        const wide = window.matchMedia("(min-width: 768px)");
        const update = () => setTextHeight(wide.matches ? text.offsetHeight : null);

        update();
        const observer = new ResizeObserver(update);
        observer.observe(text);
        wide.addEventListener("change", update);

        return () => {
            observer.disconnect();
            wide.removeEventListener("change", update);
        };
    }, []);

    const matched = textHeight !== null;

    return (
        <div className="mb-6 flex flex-col items-start gap-8 md:flex-row md:gap-0">
            {imageUrl && (
                <div
                    className={`shrink-0 ${matched ? "max-w-[50%]" : "w-full max-w-[420px] md:w-[420px]"}`}
                    style={matched ? { height: textHeight } : undefined}
                >
                    <Image
                        src={imageUrl}
                        alt="Csirkék a Héjja-farmon"
                        width={420}
                        height={280}
                        className={`block rounded-xl md:[mask-image:linear-gradient(to_right,black_55%,transparent)] md:[-webkit-mask-image:linear-gradient(to_right,black_55%,transparent)] ${
                            matched ? "h-full w-auto max-w-full object-cover object-left" : "h-auto w-full"
                        }`}
                        preload
                    />
                </div>
            )}
            <div ref={textRef} className="min-w-0 flex-1 md:pl-6">
                {children}
            </div>
        </div>
    );
}
