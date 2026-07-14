"use client";

import { useEffect, useState } from "react";

type TopHeaderProps = {
  title: string;
  subtitle: string;
  onMenuClick: () => void;
};

const jerseyDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const jerseyTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function TopHeader({ title, subtitle, onMenuClick }: TopHeaderProps) {
  const [dateText, setDateText] = useState("--");
  const [timeText, setTimeText] = useState("--:--:--");
  const [titleLeft, titleRight = ""] = title.split(" ");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setDateText(jerseyDateFormatter.format(now));
      setTimeText(jerseyTimeFormatter.format(now));
    };

    update();
    const intervalId = window.setInterval(update, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--fs-green)]/40 bg-[var(--fs-header)] px-4 py-3 backdrop-blur print:hidden md:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--fs-border)] bg-[var(--fs-panel)] text-[var(--fs-text)] md:hidden"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <div>
            <p className="text-xs font-semibold tracking-[0.2em]">
              <span className="text-white">{titleLeft} </span>
              <span className="text-[var(--fs-green-light)]">{titleRight}</span>
            </p>
            <p className="text-sm text-[var(--fs-text-muted)]">{subtitle}</p>
          </div>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <div className="rounded-lg border border-[color:var(--fs-green)]/38 bg-black/45 px-3 py-2 text-right">
            <p className="text-xs text-[var(--fs-text-muted)]">{dateText}</p>
            <p className="text-sm font-semibold text-[var(--fs-text)]">{timeText}</p>
          </div>
          <div className="rounded-lg border border-[color:var(--fs-green)]/38 bg-black/45 px-3 py-2">
            <p className="text-xs text-[var(--fs-text-muted)]">Operator</p>
            <p className="text-sm font-semibold text-[var(--fs-text)]">Diogo Ferreira</p>
          </div>
        </div>
      </div>
    </header>
  );
}
