"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StockCheckUnexpectedDialog } from "@/components/stock-check/stock-check-unexpected-dialog";
import { supabase } from "@/lib/supabase";
import { isOpenStockCheckStatus, type StockCheck } from "@/lib/compound-stock-check";

export function StockCheckMobileCard() {
  const [stockCheck, setStockCheck] = useState<StockCheck | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOpenCheck = async () => {
    const { data, error: loadError } = await supabase
      .from("compound_stock_checks")
      .select("id, status, started_at, expected_total, unexpected_total")
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setStockCheck((data as StockCheck | null) ?? null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOpenCheck();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-900">Stock Check</p>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {stockCheck && isOpenStockCheckStatus(stockCheck.status) ? (
        <>
          <p className="mt-1 text-xs text-slate-600">
            In progress · Unexpected {stockCheck.unexpected_total ?? 0}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            + Unexpected
          </button>
          <StockCheckUnexpectedDialog
            key={`${open ? "open" : "closed"}-${stockCheck.id}`}
            open={open}
            stockCheckId={stockCheck.id}
            surface="master_mobile"
            onClose={() => setOpen(false)}
            onCompleted={() => {
              void loadOpenCheck();
            }}
          />
        </>
      ) : (
        <p className="mt-2 text-xs text-slate-500">No Stock Check in progress. Start one on desktop if a physical audit is needed.</p>
      )}
      <Link href="/dashboard/compound/stock-check" className="mt-3 inline-block text-xs font-semibold text-cyan-800">
        Open full Stock Check
      </Link>
    </section>
  );
}
