import Image from "next/image";
import type { ReactNode } from "react";

export default function PreorderIntro({ imageUrl, children }: {
    imageUrl?: string | null;
    children: ReactNode;
}) {
    return (
        <div className="mb-6 flex flex-col items-start gap-8 md:flex-row">
            {imageUrl && (
                <div className="w-full max-w-[420px] shrink-0 md:w-[420px]">
                    <Image
                        src={imageUrl}
                        alt="Csirkék a Héjja-farmon"
                        width={420}
                        height={280}
                        className="block h-auto w-full rounded-xl"
                        preload
                    />
                </div>
            )}
            <div className="min-w-0 flex-1">
                {children}
            </div>
        </div>
    );
}
