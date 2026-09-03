"use client";

import { useEffect, useRef } from "react";
import { getBackgroundMotion } from "@/lib/backgroundMotion";

export default function BackgroundScene() {
    const backgroundRef = useRef<HTMLDivElement>(null);
    const headerMaskBackgroundRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const background = backgroundRef.current;
        const headerMaskBackground = headerMaskBackgroundRef.current;
        if (!background) return;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        let frameId: number | null = null;

        const update = () => {
            frameId = null;
            const { offset } = getBackgroundMotion(
                window.scrollY,
                window.innerHeight,
                reducedMotion.matches
            );

            const backgroundOffset = `${-offset}px`;
            background.style.setProperty("--background-offset", backgroundOffset);
            headerMaskBackground?.style.setProperty("--background-offset", backgroundOffset);
        };

        const requestUpdate = () => {
            if (frameId === null) frameId = window.requestAnimationFrame(update);
        };

        update();
        window.addEventListener("scroll", requestUpdate, { passive: true });
        window.addEventListener("resize", requestUpdate);
        reducedMotion.addEventListener("change", requestUpdate);

        return () => {
            window.removeEventListener("scroll", requestUpdate);
            window.removeEventListener("resize", requestUpdate);
            reducedMotion.removeEventListener("change", requestUpdate);
            if (frameId !== null) window.cancelAnimationFrame(frameId);
        };
    }, []);

    return (
        <>
            <div ref={backgroundRef} aria-hidden="true" className="site-background" />
            <div aria-hidden="true" className="site-header-scroll-mask">
                <div
                    ref={headerMaskBackgroundRef}
                    className="site-header-scroll-mask-background"
                />
            </div>
        </>
    );
}
