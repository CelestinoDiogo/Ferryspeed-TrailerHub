"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCw } from "lucide-react";
import { AlertCard } from "@/components/layout/alert-card";
import { AppCard } from "@/components/layout/app-card";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { formatDateTime, formatStatusLabel, normalizeTrailerNumber, type StockCheck, type StockCheckItem } from "@/lib/compound-stock-check";
import { supabase } from "@/lib/supabase";
import { logTrailerEvent } from "@/lib/trailer-audit-log";

type TrailerLookupRow = {
  id: string;
  customer: string | null;
  compound_position: string | null;
  load_status: string | null;
  operational_status: string | null;
};

type DiscrepancyCategory = "missing" | "unexpected" | "wrong_position" | "wrong_load_status" | "other";
type DiscrepancyFilter = "all" | "missing" | "unexpected" | "wrong_position" | "wrong_load_status" | "resolved" | "open";

type DiscrepancyRow = {
  item: StockCheckItem;
  customer: string | null;
  currentPosition: string | null;
  actualLoadStatus: string | null;
  currentOperationalStatus: string | null;
  category: DiscrepancyCategory;
  resolved: boolean;
};

type PendingConfirmDeparted = {
  stockCheckId: string;
  stockCheckItemId: string;
  trailerNumber: string;
};

type ConfirmDepartedRpcResponse = {
  stock_check_item_id?: string;
  discrepancy_type?: string | null;
  resolution_status?: string | null;
  resolution_action?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

const FILTER_OPTIONS: Array<{ key: DiscrepancyFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "missing", label: "Missing" },
  { key: "unexpected", label: "Unexpected" },
  { key: "wrong_position", label: "Wrong Position" },
  { key: "wrong_load_status", label: "Wrong Load Status" },
  { key: "resolved", label: "Resolved" },
  { key: "open", label: "Open" },
];

const OPEN_STATUSES = ["in_progress", "completed"] as const;

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const normalizePositionDisplay = (value?: string | null) => {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : "-";
};

const toDiscrepancyCategory = (value?: string | null): DiscrepancyCategory => {
  const normalized = normalizeText(value);

  if (normalized.includes("missing")) {
    return "missing";
  }

  if (normalized.includes("unexpected")) {
    return "unexpected";
  }

  if (normalized.includes("position")) {
    return "wrong_position";
  }

  if (hasOperationalStatusDiscrepancy(normalized)) {
    return "other";
  }

  if (normalized.includes("load")) {
    return "wrong_load_status";
  }

  return "other";
};

const isResolvedRow = (item: StockCheckItem) => normalizeText(item.resolution_status) === "resolved";

const statusBadgeClassName = (resolved: boolean) =>
  resolved
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-800";

const discrepancyBadgeClassName = (category: DiscrepancyCategory) => {
  if (category === "missing") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (category === "unexpected") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (category === "wrong_position") {
    return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }

  if (category === "wrong_load_status") {
    return "border-indigo-200 bg-indigo-50 text-indigo-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
};

const categoryLabel = (category: DiscrepancyCategory, fallback?: string | null) => {
  if (category === "missing") {
    return "Missing";
  }

  if (category === "unexpected") {
    return "Unexpected";
  }

  if (category === "wrong_position") {
    return "Wrong Position";
  }

  if (category === "wrong_load_status") {
    return "Wrong Load Status";
  }

  return formatStatusLabel(fallback) || "Other";
};

const hasOperationalStatusDiscrepancy = (value?: string | null) => {
  const normalized = normalizeText(value);
  return normalized.includes("operational") || normalized.includes("op_status") || normalized.includes("status_mismatch");
};

const mapConfirmDepartedErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("not found") && normalized.includes("stock check")) {
    return "Stock check not found. Refresh and try again.";
  }

  if (normalized.includes("not found") && normalized.includes("item")) {
    return "Discrepancy item not found. Refresh and try again.";
  }

  if (normalized.includes("network") || normalized.includes("connection") || normalized.includes("failed to fetch")) {
    return "Connection failed. Please try again.";
  }

  if (normalized.includes("function") && normalized.includes("not found")) {
    return "Confirm Departed action is not available in this environment yet.";
  }

  return "Unable to confirm departed right now.";
};

const isFunctionNotFoundError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("function") && (normalized.includes("does not exist") || normalized.includes("not found") || normalized.includes("could not find"));
};

const isSignatureMismatchError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("no function matches") || normalized.includes("could not choose the best candidate function") || normalized.includes("unexpected parameter") || normalized.includes("invalid input syntax");
};

const resolveOperatorName = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

const asRpcCapableSupabase = (client: typeof supabase) =>
  client as unknown as {
    rpc: (
      fn: string,
      args: Record<string, string>,
    ) => Promise<{ data: ConfirmDepartedRpcResponse[] | ConfirmDepartedRpcResponse | null; error: { message: string } | null }>;
  };

export default function CompoundReviewDiscrepanciesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlFilter = searchParams.get("filter");
  const urlStockCheckId = searchParams.get("stockCheckId");
  const [stockChecks, setStockChecks] = useState<StockCheck[]>([]);
  const [selectedStockCheckId, setSelectedStockCheckId] = useState<string>("");
  const [rows, setRows] = useState<DiscrepancyRow[]>([]);
  const [isLoadingChecks, setIsLoadingChecks] = useState(true);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<DiscrepancyFilter>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDeparted, setIsConfirmingDeparted] = useState(false);
  const [activeConfirmingDepartedItemId, setActiveConfirmingDepartedItemId] = useState<string | null>(null);
  const [pendingConfirmDeparted, setPendingConfirmDeparted] = useState<PendingConfirmDeparted | null>(null);

  const loadStockChecks = useCallback(async () => {
    setIsLoadingChecks(true);
    setError(null);

    try {
      const { data, error: loadError } = await supabase
        .from("compound_stock_checks")
        .select(
          "id, status, started_at, completed_at, cancelled_at, started_by, completed_by, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total, notes, created_at, updated_at",
        )
        .in("status", [...OPEN_STATUSES])
        .order("started_at", { ascending: false })
        .limit(50);

      if (loadError) {
        throw loadError;
      }

      const checks = data ?? [];
      setStockChecks(checks);

      if (checks.length === 0) {
        setSelectedStockCheckId("");
        return;
      }

      setSelectedStockCheckId((current) => {
        if (current && checks.some((item) => item.id === current)) {
          return current;
        }

        return checks[0].id;
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load stock checks.";
      setError(message);
    } finally {
      setIsLoadingChecks(false);
    }
  }, []);

  const loadDiscrepancies = useCallback(async (stockCheckId: string) => {
    if (!stockCheckId) {
      setRows([]);
      return;
    }

    setIsLoadingRows(true);
    setError(null);

    try {
      const { data: itemsData, error: itemsError } = await supabase
        .from("compound_stock_check_items")
        .select(
          "id, stock_check_id, trailer_id, trailer_number, expected_in_compound, physically_present, expected_position, actual_position, system_load_status, system_operational_status, discrepancy_type, checked_at, checked_by, resolution_status, resolution_action, resolved_at, resolved_by, notes, created_at, updated_at",
        )
        .eq("stock_check_id", stockCheckId)
        .order("checked_at", { ascending: false })
        .order("trailer_number", { ascending: true });

      if (itemsError) {
        throw itemsError;
      }

      const loadedItems = itemsData ?? [];
      const trailerIds = [...new Set(loadedItems.map((item) => item.trailer_id).filter((id): id is string => Boolean(id)))];

      let trailersById = new Map<string, TrailerLookupRow>();
      if (trailerIds.length > 0) {
        const { data: trailersData, error: trailersError } = await supabase
          .from("trailers")
          .select("id, customer, compound_position, load_status, operational_status")
          .in("id", trailerIds);

        if (trailersError) {
          throw trailersError;
        }

        trailersById = new Map((trailersData ?? []).map((item) => [item.id, item]));
      }

      const discrepancyRows = loadedItems
        .map((item) => {
          const category = toDiscrepancyCategory(item.discrepancy_type);
          const hasDiscrepancy = category !== "other" || Boolean(item.resolution_action?.trim()) || Boolean(item.resolution_status?.trim());

          if (!hasDiscrepancy) {
            return null;
          }

          const trailer = item.trailer_id ? trailersById.get(item.trailer_id) : undefined;

          return {
            item,
            customer: trailer?.customer ?? null,
            currentPosition: trailer?.compound_position ?? null,
            actualLoadStatus: trailer?.load_status ?? null,
            currentOperationalStatus: trailer?.operational_status ?? null,
            category,
            resolved: isResolvedRow(item),
          } satisfies DiscrepancyRow;
        })
        .filter((item): item is DiscrepancyRow => item !== null);

      setRows(discrepancyRows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load discrepancies.";
      setError(message);
    } finally {
      setIsLoadingRows(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadStockChecks();
  }, [loadStockChecks]);

  useEffect(() => {
    if (!selectedStockCheckId) {
      setRows([]);
      return;
    }

    void loadDiscrepancies(selectedStockCheckId);
  }, [loadDiscrepancies, selectedStockCheckId]);

  useEffect(() => {
    const validFilters: DiscrepancyFilter[] = ["all", "missing", "unexpected", "wrong_position", "wrong_load_status", "resolved", "open"];
    if (urlFilter && validFilters.includes(urlFilter as DiscrepancyFilter)) {
      setFilter(urlFilter as DiscrepancyFilter);
    }
  }, [urlFilter]);

  useEffect(() => {
    if (!urlStockCheckId || stockChecks.length === 0) {
      return;
    }

    if (stockChecks.some((item) => item.id === urlStockCheckId)) {
      setSelectedStockCheckId(urlStockCheckId);
    }
  }, [stockChecks, urlStockCheckId]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  const callConfirmDepartedRpc = useCallback(
    async (stockCheckId: string, stockCheckItemId: string, operatorName: string) => {
      const rpcClient = asRpcCapableSupabase(supabase);

      const attempts: Array<{ functionName: string; args: Record<string, string> }> = [
        {
          functionName: "confirm_stock_check_missing_departed",
          args: {
            p_stock_check_id: stockCheckId,
            p_stock_check_item_id: stockCheckItemId,
            p_confirmed_by: operatorName,
          },
        },
        {
          functionName: "confirm_stock_check_missing_departed",
          args: {
            p_stock_check_id: stockCheckId,
            p_stock_check_item_id: stockCheckItemId,
            p_changed_by: operatorName,
          },
        },
        {
          functionName: "confirm_stock_check_trailer_departed",
          args: {
            p_stock_check_id: stockCheckId,
            p_stock_check_item_id: stockCheckItemId,
            p_confirmed_by: operatorName,
          },
        },
        {
          functionName: "resolve_stock_check_missing_departed",
          args: {
            p_stock_check_id: stockCheckId,
            p_stock_check_item_id: stockCheckItemId,
            p_changed_by: operatorName,
          },
        },
      ];

      let lastErrorMessage = "Unable to confirm departed right now.";

      for (const attempt of attempts) {
        const { data, error: rpcError } = await rpcClient.rpc(attempt.functionName, attempt.args);

        if (!rpcError) {
          return data;
        }

        lastErrorMessage = rpcError.message;
        if (isFunctionNotFoundError(rpcError.message) || isSignatureMismatchError(rpcError.message)) {
          continue;
        }

        throw new Error(mapConfirmDepartedErrorMessage(rpcError.message));
      }

      throw new Error(mapConfirmDepartedErrorMessage(lastErrorMessage));
    },
    [],
  );

  const selectedStockCheck = useMemo(
    () => stockChecks.find((item) => item.id === selectedStockCheckId) ?? null,
    [selectedStockCheckId, stockChecks],
  );

  const filteredRows = useMemo(() => {
    const term = normalizeText(search);

    return rows.filter((row) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "resolved"
            ? row.resolved
            : filter === "open"
              ? !row.resolved
              : row.category === filter;

      if (!matchesFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        row.item.trailer_number,
        row.customer,
        row.item.expected_position,
        row.item.actual_position,
        row.currentPosition,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [filter, rows, search]);

  const kpis = useMemo(() => {
    const missing = rows.filter((row) => row.category === "missing").length;
    const unexpected = rows.filter((row) => row.category === "unexpected").length;
    const wrongPosition = rows.filter((row) => row.category === "wrong_position").length;
    const wrongLoadStatus = rows.filter((row) => row.category === "wrong_load_status").length;
    const resolved = rows.filter((row) => row.resolved).length;

    return { missing, unexpected, wrongPosition, wrongLoadStatus, resolved };
  }, [rows]);

  const handleRefresh = async () => {
    if (!selectedStockCheckId || isLoadingRows || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    await loadDiscrepancies(selectedStockCheckId);
  };

  const handleOpenStockCheck = (message: string) => {
    setNotice(message);
    router.push("/dashboard/compound/stock-check");
  };

  const openConfirmDepartedModal = (row: DiscrepancyRow) => {
    if (row.resolved) {
      return;
    }

    if (!selectedStockCheckId) {
      setError("Stock check not selected.");
      return;
    }

    setPendingConfirmDeparted({
      stockCheckId: selectedStockCheckId,
      stockCheckItemId: row.item.id,
      trailerNumber: row.item.trailer_number ?? "Unknown",
    });
  };

  const handleConfirmDeparted = async () => {
    if (!pendingConfirmDeparted) {
      return;
    }

    if (isConfirmingDeparted) {
      return;
    }

    setIsConfirmingDeparted(true);
    setActiveConfirmingDepartedItemId(pendingConfirmDeparted.stockCheckItemId);
    setError(null);

    try {
      const operatorName = await resolveOperatorName();
      const rpcData = await callConfirmDepartedRpc(
        pendingConfirmDeparted.stockCheckId,
        pendingConfirmDeparted.stockCheckItemId,
        operatorName,
      );

      const rpcRow = Array.isArray(rpcData) ? (rpcData[0] ?? null) : rpcData;

      const resolvedAt = rpcRow?.resolved_at ?? new Date().toISOString();
      const resolvedBy = rpcRow?.resolved_by ?? operatorName;
      const resolutionStatus = rpcRow?.resolution_status ?? "resolved";
      const discrepancyType = rpcRow?.discrepancy_type ?? "missing";
      const resolutionAction = rpcRow?.resolution_action ?? "confirmed_departed";
      const targetRow = rows.find((row) => row.item.id === pendingConfirmDeparted.stockCheckItemId);
      const targetTrailerId = targetRow?.item.trailer_id ?? null;
      const targetTrailerNumber = targetRow?.item.trailer_number ?? pendingConfirmDeparted.trailerNumber;

      setRows((currentRows) =>
        currentRows.map((row) => {
          if (row.item.id !== pendingConfirmDeparted.stockCheckItemId) {
            return row;
          }

          const nextItem: StockCheckItem = {
            ...row.item,
            discrepancy_type: discrepancyType,
            resolution_status: resolutionStatus,
            resolution_action: resolutionAction,
            resolved_at: resolvedAt,
            resolved_by: resolvedBy,
          };

          return {
            ...row,
            item: nextItem,
            resolved: true,
          };
        }),
      );

      await logTrailerEvent({
        trailerId: targetTrailerId,
        trailerNumber: targetTrailerNumber,
        eventType: "stock_check_confirm_departed",
        description: "Missing trailer confirmed as departed from Review Discrepancies.",
        previousValue: {
          stock_check_id: pendingConfirmDeparted.stockCheckId,
          stock_check_item_id: pendingConfirmDeparted.stockCheckItemId,
          resolution_status: "open",
        },
        newValue: {
          stock_check_id: pendingConfirmDeparted.stockCheckId,
          stock_check_item_id: pendingConfirmDeparted.stockCheckItemId,
          resolution_status: resolutionStatus,
          resolution_action: resolutionAction,
          discrepancy_type: discrepancyType,
          resolved_by: resolvedBy,
          resolved_at: resolvedAt,
        },
        sourceModule: "review_discrepancies",
        performedBy: resolvedBy,
        performedAt: resolvedAt,
      });

      setNotice(`${normalizeTrailerNumber(pendingConfirmDeparted.trailerNumber)} successfully marked as departed.`);
      setPendingConfirmDeparted(null);
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : "Unable to confirm departed right now.";
      setError(message);
    } finally {
      setIsConfirmingDeparted(false);
      setActiveConfirmingDepartedItemId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Compound"
        title="Review Discrepancies"
        description="Review and reconcile discrepancies captured during stock checks, with filters and operational follow-up actions."
        action={
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={!selectedStockCheckId || isLoadingRows || isRefreshing}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        }
      />

      {error ? <AlertCard title="Unable to load discrepancies" description={error} tone="critical" /> : null}

      {notice ? (
        <AppCard className="border border-cyan-200 bg-cyan-50">
          <div className="px-4 py-3 text-sm text-cyan-800">{notice}</div>
        </AppCard>
      ) : null}

      {isLoadingChecks ? <LoadingState label="Loading stock checks..." /> : null}

      {!isLoadingChecks && stockChecks.length === 0 ? (
        <EmptyState
          title="No stock checks available"
          description="Complete or in-progress stock checks will appear here for discrepancy review."
        />
      ) : null}

      {!isLoadingChecks && stockChecks.length > 0 ? (
        <>
          <AppCard>
            <div className="p-5 md:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-900" htmlFor="selectedStockCheck">
                  Stock Check
                  <select
                    id="selectedStockCheck"
                    value={selectedStockCheckId}
                    onChange={(event) => setSelectedStockCheckId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500"
                  >
                    {stockChecks.map((check) => (
                      <option key={check.id} value={check.id}>
                        {`${formatDateTime(check.started_at)} · ${formatStatusLabel(check.status)} · ${check.started_by ?? "Unknown"}`}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected Check</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatDateTime(selectedStockCheck?.started_at)}</p>
                  <p className="mt-1">Status: {formatStatusLabel(selectedStockCheck?.status)}</p>
                </div>
              </div>
            </div>
          </AppCard>

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Missing" value={String(kpis.missing)} />
            <StatCard label="Unexpected" value={String(kpis.unexpected)} />
            <StatCard label="Wrong Position" value={String(kpis.wrongPosition)} />
            <StatCard label="Wrong Load Status" value={String(kpis.wrongLoadStatus)} />
            <StatCard label="Resolved" value={String(kpis.resolved)} />
          </section>

          <AppCard>
            <div className="p-5 md:p-6">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <label className="text-sm font-semibold text-slate-900" htmlFor="discrepancySearch">
                  Search by Trailer Number, Customer or Position
                  <input
                    id="discrepancySearch"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search trailer, customer, expected or actual position..."
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setFilter(option.key)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        filter === option.key
                          ? "bg-cyan-600 text-white"
                          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </AppCard>

          <AppCard>
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Discrepancy Items</h2>
              <p className="mt-1 text-sm text-slate-500">Actions are enabled only where implemented. Remaining actions are prepared for upcoming sprints.</p>

              {isLoadingRows ? (
                <p className="mt-4 text-sm text-slate-500">Loading discrepancy rows...</p>
              ) : filteredRows.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No discrepancy rows match the current filters.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-[1250px] text-left text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <th className="px-2 py-3 font-semibold">Trailer Number</th>
                        <th className="px-2 py-3 font-semibold">Customer</th>
                        <th className="px-2 py-3 font-semibold">Expected Position</th>
                        <th className="px-2 py-3 font-semibold">Actual Position</th>
                        <th className="px-2 py-3 font-semibold">System Load Status</th>
                        <th className="px-2 py-3 font-semibold">Actual Load Status</th>
                        <th className="px-2 py-3 font-semibold">Discrepancy Type</th>
                        <th className="px-2 py-3 font-semibold">Resolution Status</th>
                        <th className="px-2 py-3 font-semibold">Checked By</th>
                        <th className="px-2 py-3 font-semibold">Checked At</th>
                        <th className="px-2 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => {
                        const trailerNumber = normalizeTrailerNumber(row.item.trailer_number ?? "-");
                        const hasTrailerLink = Boolean(row.item.trailer_id);
                        const hasOperationalDiscrepancy = hasOperationalStatusDiscrepancy(row.item.discrepancy_type);
                        const operationalReason = row.item.resolution_action?.trim() || row.item.notes?.trim() || categoryLabel(row.category, row.item.discrepancy_type);
                        const operationalChangeSummary = row.item.resolution_action?.includes("operational_status_change:") ? row.item.resolution_action : null;

                        return (
                          <tr key={row.item.id} className="border-b border-slate-100 align-top last:border-b-0">
                            <td className="px-2 py-3 font-semibold text-slate-900">{trailerNumber}</td>
                            <td className="px-2 py-3">{row.customer ?? "-"}</td>
                            <td className="px-2 py-3">{normalizePositionDisplay(row.item.expected_position)}</td>
                            <td className="px-2 py-3">{normalizePositionDisplay(row.item.actual_position)}</td>
                            <td className="px-2 py-3">{formatStatusLabel(row.item.system_load_status)}</td>
                            <td className="px-2 py-3">{formatStatusLabel(row.actualLoadStatus)}</td>
                            <td className="px-2 py-3">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${discrepancyBadgeClassName(row.category)}`}>
                                {categoryLabel(row.category, row.item.discrepancy_type)}
                              </span>
                            </td>
                            <td className="px-2 py-3">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusBadgeClassName(row.resolved)}`}>
                                {row.resolved ? "Resolved" : "Open"}
                              </span>
                            </td>
                            <td className="px-2 py-3">{row.item.checked_by ?? "-"}</td>
                            <td className="px-2 py-3">{formatDateTime(row.item.checked_at)}</td>
                            <td className="px-2 py-3">
                              <div className="flex min-w-[190px] flex-col gap-1.5">
                                {row.category === "wrong_position" ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStockCheck("Use Stock Check to run Change Position.")}
                                    disabled={!hasTrailerLink}
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Change Position
                                  </button>
                                ) : null}

                                {row.category === "wrong_load_status" ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStockCheck("Use Stock Check to run Change Load Status.")}
                                    disabled={!hasTrailerLink}
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Change Load Status
                                  </button>
                                ) : null}

                                {row.category === "missing" ? (
                                  <>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Still Searching · Coming Soon</button>
                                    <button
                                      type="button"
                                      onClick={() => openConfirmDepartedModal(row)}
                                      disabled={row.resolved || isConfirmingDeparted}
                                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {activeConfirmingDepartedItemId === row.item.id && isConfirmingDeparted
                                        ? "Confirming..."
                                        : "Confirm Departed"}
                                    </button>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Ignore Discrepancy · Coming Soon</button>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Add Note · Coming Soon</button>
                                  </>
                                ) : null}

                                {row.category === "unexpected" ? (
                                  <>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Create Arrival · Coming Soon</button>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Link Existing Trailer · Coming Soon</button>
                                    <button type="button" disabled className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">Ignore · Coming Soon</button>
                                  </>
                                ) : null}

                                {row.category === "other" ? (
                                  <span className="text-xs text-slate-500">No action available yet.</span>
                                ) : null}

                                {hasOperationalDiscrepancy ? (
                                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                                    <p className="font-semibold uppercase tracking-[0.14em] text-slate-500">Operational Status</p>
                                    <p className="mt-1">Current Status: {formatStatusLabel(row.currentOperationalStatus)}</p>
                                    <p>Suggested Status: {formatStatusLabel(row.item.system_operational_status)}</p>
                                    <p>Reason: {operationalReason || "Operational discrepancy detected."}</p>
                                    {operationalChangeSummary ? <p className="mt-1 text-slate-500">History: {operationalChangeSummary}</p> : null}
                                    {hasTrailerLink ? (
                                      <Link
                                        href={`/dashboard/trailers/${row.item.trailer_id}`}
                                        className="mt-2 inline-flex rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                      >
                                        Open Trailer Workflow
                                      </Link>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </AppCard>
        </>
      ) : null}

      {pendingConfirmDeparted ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4" role="dialog" aria-modal="true" aria-label="Confirm departed discrepancy">
          <AppCard className="w-full max-w-lg">
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Confirm Departed</h2>
              <p className="mt-3 text-sm text-slate-600">Confirm that this missing trailer has departed and resolve the discrepancy.</p>

              <dl className="mt-4 grid gap-3 text-sm text-slate-700">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Trailer</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{normalizeTrailerNumber(pendingConfirmDeparted.trailerNumber)}</dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirmDeparted(null)}
                  disabled={isConfirmingDeparted}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmDeparted()}
                  disabled={isConfirmingDeparted}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isConfirmingDeparted ? "Confirming..." : "Confirm Departed"}
                </button>
              </div>
            </div>
          </AppCard>
        </div>
      ) : null}
    </div>
  );
}
