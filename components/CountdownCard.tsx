// components/CountdownCard.tsx
"use client";

import { useEffect, useState } from "react";
import { getOrderWindowEnd, getOrderWindowStart } from "@/lib/orderWindow";

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

function getTimeLeft(targetDate: string | Date) {
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

  const start = getOrderWindowStart(startDate);
  const end = getOrderWindowEnd(endDate);

  if (!start || !end) {
    return null;
  }

  const isBeforeStart = now < start;
  const isActive = now >= start && now <= end;
  const isClosed = now > end;

  const timeLeft = isBeforeStart
    ? getTimeLeft(start)
    : getTimeLeft(end);

 return (
  <div className="mt-4 rounded-xl bg-white border border-gray-200 shadow-sm p-5 text-gray-700">

    <div className="grid grid-cols-1 items-center gap-4 text-lg leading-6 text-gray-600 sm:grid-cols-3 sm:gap-0">
      <div className="text-center">
        <span className="font-semibold">Előrendelés kezdete:</span>
        <br />
        {formatDate(start.toISOString())}
      </div>

      <div className="border-gray-300 text-center sm:border-x">
        <span className="font-semibold">Előrendelés vége:</span>
        <br />
        {formatDate(end.toISOString())}
      </div>

      <div className="text-center font-semibold text-gray-700">
        {isBeforeStart && (
          <>
            Kezdésig hátralévő idő
            <br />
            <span className="text-blue-700">{timeLeft}</span>
          </>
        )}

        {isActive && (
          <>
            Hátralévő idő
            <br />
            <span className="text-blue-700">{timeLeft}</span>
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
