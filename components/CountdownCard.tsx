// components/CountdownCard.tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  startDate?: string | null;
  endDate?: string | null;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeLeft(targetDate: string) {
  const now = new Date();
  const target = new Date(targetDate);

  const diff = target.getTime() - now.getTime();

  if (diff <= 0) return null;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor(
    (diff % (1000 * 60 * 60)) / (1000 * 60)
  );

  return `${days} nap ${hours} óra ${minutes} perc`;
}

export default function CountdownCard({ startDate, endDate }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!startDate || !endDate) {
    return null;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  const isBeforeStart = now < start;
  const isActive = now >= start && now <= end;
  const isClosed = now > end;

  const timeLeft = isBeforeStart
    ? getTimeLeft(startDate)
    : getTimeLeft(endDate);

 return (
  <div className="mt-10 rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-gray-700">

    <div className="grid grid-cols-3 items-center text-sm text-gray-600 leading-5">
      <div className="text-center">
        <span className="font-semibold">Előrendelés kezdete:</span>
        <br />
        {formatDate(startDate)}
      </div>

      <div className="text-center border-x border-gray-300">
        <span className="font-semibold">Előrendelés vége:</span>
        <br />
        {formatDate(endDate)}
      </div>

      <div className="text-center font-semibold text-gray-700">
        {isBeforeStart && (
          <>
            Kezdésig hátralévő idő
            <br />
            {timeLeft}
          </>
        )}

        {isActive && (
          <>
            Hátralévő idő
            <br />
            {timeLeft}
          </>
        )}

        {isClosed && (
          <>
            Az előrendelés
            <br />
            lezárult.
          </>
        )}
      </div>
    </div>
  </div>
);
}