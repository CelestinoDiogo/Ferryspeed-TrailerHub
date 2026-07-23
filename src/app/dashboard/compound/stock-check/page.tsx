"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { AlertCard } from "@/components/layout/alert-card";
import { AppCard } from "@/components/layout/app-card";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { supabase } from "@/lib/supabase";
import { createTrailerActivity } from "@/lib/trailer-activity";
import { logTrailerEvent } from "@/lib/trailer-audit-log";
import {
  formatDateTime,
  formatStatusLabel,
  normalizeTrailerNumber,
  toCheckStatus,
  type StockCheck,
  type StockCheckItem,
} from "@/lib/compound-stock-check";

const OPEN_STATUS = "in_progress";

type ScanNoticeTone = "success" | "warning" | "error" | "info";
type MarkPresentResult = "marked_present" | "already_present" | "unexpected";
type TrailerLoadStatus = "empty" | "loaded";

type MarkPresentRpcRow = {
  stock_check_id: string;
  stock_check_item_id: string | null;
  trailer_number: string;
  result: MarkPresentResult;
  checked_total: number | null;
  present_total: number | null;
  expected_total: number | null;
  remaining_total: number | null;
};

type ChangeLoadStatusRpcRow = {
  stock_check_item_id: string;
  trailer_id: string;
  trailer_number: string;
  previous_load_status: string | null;
  new_load_status: string | null;
  discrepancy_type: string | null;
  resolution_status: string | null;
};

type ChangePositionRpcRow = {
  stock_check_item_id: string;
  trailer_id: string;
  trailer_number: string;
  previous_position: string | null;
  new_position: string | null;
  discrepancy_type: string | null;
  resolution_status: string | null;
};

type PendingLoadStatusChange = {
  stockCheckItemId: string;
  trailerNumber: string;
  currentStatus: TrailerLoadStatus;
  newStatus: TrailerLoadStatus;
};

type PendingPositionChange = {
  stockCheckItemId: string;
  trailerNumber: string;
  currentSystemPosition: string;
  expectedPosition: string;
  enteredPosition: string;
};

const getStatusBadgeClassName = (status?: string | null) => {
  if (status === OPEN_STATUS) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "completed") {
    return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }

  if (status === "cancelled") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
};

const getCheckStatusBadgeClassName = (value: boolean | null) => {
  const status = toCheckStatus(value);

  if (status === "present") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "missing") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
};

const getCheckStatusLabel = (value: boolean | null) => {
  const status = toCheckStatus(value);

  if (status === "present") {
    return "Present";
  }

  if (status === "missing") {
    return "Missing";
  }

  return "Unchecked";
};

const getLoadStatusValue = (value?: string | null): TrailerLoadStatus | null => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "empty") {
    return "empty";
  }

  if (normalized === "loaded") {
    return "loaded";
  }

  return null;
};

const getLoadStatusLabel = (value?: string | null) => {
  const status = getLoadStatusValue(value);
  if (status === "empty") {
    return "Empty";
  }

  if (status === "loaded") {
    return "Loaded";
  }

  return "Unknown";
};

const getLoadStatusBadgeClassName = (value?: string | null) => {
  const status = getLoadStatusValue(value);

  if (status === "empty") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }

  if (status === "loaded") {
    return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
};

const normalizePositionDisplay = (value?: string | null) => {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : "-";
};

const isPositionResolved = (item: StockCheckItem) => {
  const discrepancy = item.discrepancy_type?.trim().toLowerCase() ?? "";
  const resolution = item.resolution_status?.trim().toLowerCase() ?? "";
  return discrepancy.includes("position") && resolution === "resolved";
};

const mapStartErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("in_progress") || (normalized.includes("already") && normalized.includes("stock check"))) {
    return "An open stock check already exists. Complete or cancel it before starting another one.";
  }

  return message;
};

const mapMarkPresentErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("already completed") || normalized.includes("completed") || normalized.includes("no longer in progress")) {
    return "This stock check is already completed.";
  }

  if ((normalized.includes("stock check") && normalized.includes("not found")) || normalized.includes("does not exist")) {
    return "Stock check not found. Refresh the page and try again.";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("connection")) {
    return "Connection failed. Please try again.";
  }

  return "Unable to mark trailer as present right now.";
};

const mapChangeLoadStatusErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("stock check") && normalized.includes("not found")) {
    return "Stock check not found. Refresh the page and try again.";
  }

  if (normalized.includes("item") && normalized.includes("not found")) {
    return "Stock check item not found. Refresh and try again.";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("connection")) {
    return "Connection failed. Please try again.";
  }

  return "Unable to change trailer load status right now.";
};

const mapChangePositionErrorMessage = (message: string) => {
  const normalized = message.trim().toLowerCase();

  if (normalized.includes("occupied") || normalized.includes("already occupied")) {
    return message;
  }

  if (normalized.includes("invalid") && normalized.includes("position")) {
    return "Invalid position. Please enter a valid compound position.";
  }

  if (normalized.includes("stock check") && normalized.includes("not found")) {
    return "Stock check not found. Refresh the page and try again.";
  }

  if (normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("connection")) {
    return "Connection failed. Please try again.";
  }

  return "Unable to change trailer position right now.";
};

const isMarkPresentRpcRow = (value: unknown): value is MarkPresentRpcRow => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const result = record.result;
  const trailerNumber = record.trailer_number;

  return (
    typeof record.stock_check_id === "string" &&
    (typeof record.stock_check_item_id === "string" || record.stock_check_item_id === null) &&
    typeof trailerNumber === "string" &&
    (result === "marked_present" || result === "already_present" || result === "unexpected")
  );
};

const extractMarkPresentRpcRow = (value: unknown): MarkPresentRpcRow | null => {
  if (Array.isArray(value)) {
    const first = value[0];
    return isMarkPresentRpcRow(first) ? first : null;
  }

  return isMarkPresentRpcRow(value) ? value : null;
};

const isChangeLoadStatusRpcRow = (value: unknown): value is ChangeLoadStatusRpcRow => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.stock_check_item_id === "string" &&
    typeof record.trailer_id === "string" &&
    typeof record.trailer_number === "string" &&
    (typeof record.previous_load_status === "string" || record.previous_load_status === null) &&
    (typeof record.new_load_status === "string" || record.new_load_status === null) &&
    (typeof record.discrepancy_type === "string" || record.discrepancy_type === null) &&
    (typeof record.resolution_status === "string" || record.resolution_status === null)
  );
};

const extractChangeLoadStatusRpcRow = (value: unknown): ChangeLoadStatusRpcRow | null => {
  if (Array.isArray(value)) {
    const first = value[0];
    return isChangeLoadStatusRpcRow(first) ? first : null;
  }

  return isChangeLoadStatusRpcRow(value) ? value : null;
};

const isChangePositionRpcRow = (value: unknown): value is ChangePositionRpcRow => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.stock_check_item_id === "string" &&
    typeof record.trailer_id === "string" &&
    typeof record.trailer_number === "string" &&
    (typeof record.previous_position === "string" || record.previous_position === null) &&
    (typeof record.new_position === "string" || record.new_position === null) &&
    (typeof record.discrepancy_type === "string" || record.discrepancy_type === null) &&
    (typeof record.resolution_status === "string" || record.resolution_status === null)
  );
};

const extractChangePositionRpcRow = (value: unknown): ChangePositionRpcRow | null => {
  if (Array.isArray(value)) {
    const first = value[0];
    return isChangePositionRpcRow(first) ? first : null;
  }

  return isChangePositionRpcRow(value) ? value : null;
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

export default function CompoundStockCheckPage() {
  const [openStockCheck, setOpenStockCheck] = useState<StockCheck | null>(null);
  const [items, setItems] = useState<StockCheckItem[]>([]);
  const [recentChecks, setRecentChecks] = useState<StockCheck[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanNoticeTone, setScanNoticeTone] = useState<ScanNoticeTone>("success");
  const [isMarking, setIsMarking] = useState(false);
  const [activeMarkingTrailer, setActiveMarkingTrailer] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [remainingTotal, setRemainingTotal] = useState<number | null>(null);
  const [isChangingLoadStatus, setIsChangingLoadStatus] = useState(false);
  const [activeLoadStatusItemId, setActiveLoadStatusItemId] = useState<string | null>(null);
  const [pendingLoadStatusChange, setPendingLoadStatusChange] = useState<PendingLoadStatusChange | null>(null);
  const [isChangingPosition, setIsChangingPosition] = useState(false);
  const [activePositionItemId, setActivePositionItemId] = useState<string | null>(null);
  const [pendingPositionChange, setPendingPositionChange] = useState<PendingPositionChange | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const tableRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const showScanNotice = useCallback((message: string, tone: ScanNoticeTone) => {
    setScanNotice(message);
    setScanNoticeTone(tone);
  }, []);

  const loadStockCheckItems = useCallback(async (stockCheck: StockCheck) => {
    const { data: itemData, error: itemError } = await supabase
      .from("compound_stock_check_items")
      .select(
        "id, stock_check_id, trailer_id, trailer_number, expected_in_compound, physically_present, expected_position, actual_position, system_load_status, system_operational_status, discrepancy_type, checked_at, checked_by, resolution_status, resolution_action, resolved_at, resolved_by, notes, created_at, updated_at",
      )
      .eq("stock_check_id", stockCheck.id)
      .order("expected_position", { ascending: true })
      .order("trailer_number", { ascending: true });

    if (itemError) {
      throw itemError;
    }

    setOpenStockCheck(stockCheck);
    setItems(itemData ?? []);
    setRemainingTotal(Math.max((stockCheck.expected_total ?? 0) - (stockCheck.checked_total ?? 0), 0));
  }, []);

  const loadStockCheckData = useCallback(async (refreshOnly = false) => {
    if (refreshOnly) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setPageError(null);

    try {
      const { data: openData, error: openError } = await supabase
        .from("compound_stock_checks")
        .select(
          "id, status, started_at, completed_at, cancelled_at, started_by, completed_by, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total, notes, created_at, updated_at",
        )
        .eq("status", OPEN_STATUS)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openError) {
        throw openError;
      }

      if (openData) {
        await loadStockCheckItems(openData);
        setRecentChecks([]);
        return;
      }

      const { data: recentData, error: recentError } = await supabase
        .from("compound_stock_checks")
        .select(
          "id, status, started_at, completed_at, cancelled_at, started_by, completed_by, expected_total, checked_total, present_total, missing_total, unexpected_total, wrong_position_total, wrong_status_total, notes, created_at, updated_at",
        )
        .order("started_at", { ascending: false })
        .limit(10);

      if (recentError) {
        throw recentError;
      }

      setOpenStockCheck(null);
      setItems([]);
      setRecentChecks(recentData ?? []);
      setRemainingTotal(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load stock check data.";
      setPageError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [loadStockCheckItems]);

  useEffect(() => {
    void loadStockCheckData(false);
  }, [loadStockCheckData]);

  useEffect(() => {
    if (openStockCheck && scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, [openStockCheck]);

  useEffect(() => {
    if (!scanNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setScanNotice(null);
    }, 3500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scanNotice]);

  useEffect(() => {
    if (!highlightedItemId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setHighlightedItemId(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [highlightedItemId]);

  const handleStartStockCheck = async () => {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setPageError(null);
    setActionNotice(null);

    try {
      const operatorName = await resolveOperatorName();

      const { error } = await supabase.rpc("start_compound_stock_check", {
        p_started_by: operatorName,
      });

      if (error) {
        throw new Error(mapStartErrorMessage(error.message));
      }

      await logTrailerEvent({
        trailerId: null,
        trailerNumber: null,
        eventType: "stock_check_started",
        description: "Compound stock check started.",
        previousValue: null,
        newValue: {
          started_by: operatorName,
        },
        sourceModule: "stock_check",
        performedBy: operatorName,
      });

      await loadStockCheckData(true);
      setActionNotice("Stock check started successfully.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start stock check.";
      setPageError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleRefresh = async () => {
    if (isRefreshing || isLoading || isStarting || isMarking || isChangingLoadStatus || isChangingPosition) {
      return;
    }

    setActionNotice(null);
    await loadStockCheckData(true);
  };

  const handleReviewStockCheck = async (stockCheck: StockCheck) => {
    if (isRefreshing || isLoading || isStarting || isMarking || isChangingLoadStatus || isChangingPosition) {
      return;
    }

    if (stockCheck.status !== "in_progress" && stockCheck.status !== "completed") {
      showScanNotice("Only in-progress or completed stock checks can be reviewed.", "warning");
      return;
    }

    setIsRefreshing(true);
    setPageError(null);
    setActionNotice(null);

    try {
      await loadStockCheckItems(stockCheck);
      setActionNotice(`Reviewing ${formatStatusLabel(stockCheck.status)} stock check.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load selected stock check.";
      setPageError(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const markTrailerPresent = useCallback(
    async (trailerNumber: string, source: "scan" | "button") => {
      if (!openStockCheck?.id) {
        showScanNotice("No active stock check found. Refresh the page and try again.", "error");
        return;
      }

      const normalizedTrailerNumber = normalizeTrailerNumber(trailerNumber);
      if (!normalizedTrailerNumber) {
        return;
      }

      if (isMarking) {
        showScanNotice("Another trailer is being processed. Please wait.", "info");
        return;
      }

      setIsMarking(true);
      setActiveMarkingTrailer(normalizedTrailerNumber);
      setPageError(null);

      try {
        const operatorName = await resolveOperatorName();

        const { data, error } = await supabase.rpc("mark_compound_stock_check_present", {
          p_stock_check_id: openStockCheck.id,
          p_trailer_number: normalizedTrailerNumber,
          p_checked_by: operatorName,
        });

        if (error) {
          throw new Error(mapMarkPresentErrorMessage(error.message));
        }

        const rpcRow = extractMarkPresentRpcRow(data);
        if (!rpcRow) {
          throw new Error("No response was returned. Please try again.");
        }

        const normalizedReturnedTrailer = normalizeTrailerNumber(rpcRow.trailer_number);
        const nowIso = new Date().toISOString();

        if (rpcRow.result === "marked_present") {
          const targetItem = items.find((item) => normalizeTrailerNumber(item.trailer_number ?? "") === normalizedReturnedTrailer);

          setItems((currentItems) =>
            currentItems.map((item) => {
              const isSameItemById = rpcRow.stock_check_item_id ? item.id === rpcRow.stock_check_item_id : false;
              const isSameItemByTrailer = normalizeTrailerNumber(item.trailer_number ?? "") === normalizedReturnedTrailer;

              if (!isSameItemById && !isSameItemByTrailer) {
                return item;
              }

              return {
                ...item,
                physically_present: true,
                discrepancy_type: "matched",
                checked_at: item.checked_at ?? nowIso,
                checked_by: operatorName,
              };
            }),
          );

          setOpenStockCheck((currentCheck) => {
            if (!currentCheck) {
              return currentCheck;
            }

            return {
              ...currentCheck,
              expected_total: rpcRow.expected_total ?? currentCheck.expected_total,
              checked_total: rpcRow.checked_total ?? currentCheck.checked_total,
              present_total: rpcRow.present_total ?? currentCheck.present_total,
            };
          });
          setRemainingTotal(Math.max(rpcRow.remaining_total ?? 0, 0));

          await logTrailerEvent({
            trailerId: targetItem?.trailer_id ?? null,
            trailerNumber: normalizedReturnedTrailer,
            eventType: "stock_check_mark_present",
            description: "Trailer marked as present during stock check.",
            previousValue: {
              physically_present: targetItem?.physically_present ?? null,
              checked_at: targetItem?.checked_at ?? null,
              checked_by: targetItem?.checked_by ?? null,
            },
            newValue: {
              stock_check_id: openStockCheck.id,
              physically_present: true,
              checked_at: nowIso,
              checked_by: operatorName,
            },
            sourceModule: "stock_check",
            performedBy: operatorName,
          });

          if ((rpcRow.remaining_total ?? 0) === 0) {
            await logTrailerEvent({
              trailerId: null,
              trailerNumber: null,
              eventType: "stock_check_completed",
              description: "Compound stock check reached completion.",
              previousValue: {
                stock_check_id: openStockCheck.id,
                checked_total: openStockCheck.checked_total ?? null,
                present_total: openStockCheck.present_total ?? null,
              },
              newValue: {
                stock_check_id: openStockCheck.id,
                checked_total: rpcRow.checked_total ?? null,
                present_total: rpcRow.present_total ?? null,
                expected_total: rpcRow.expected_total ?? null,
              },
              sourceModule: "stock_check",
              performedBy: operatorName,
            });
          }

          showScanNotice(`${normalizedReturnedTrailer} marked as present.`, "success");

          if (source === "scan") {
            const targetItemId = rpcRow.stock_check_item_id ?? targetItem?.id ?? null;

            if (targetItemId) {
              setHighlightedItemId(targetItemId);
              window.requestAnimationFrame(() => {
                const targetRow = tableRowRefs.current[targetItemId];
                if (targetRow) {
                  targetRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
              });
            }
          }

          return;
        }

        if (rpcRow.result === "already_present") {
          showScanNotice(`${normalizedReturnedTrailer} was already checked.`, "warning");
          return;
        }

        if (rpcRow.result === "unexpected") {
          showScanNotice(`${normalizedReturnedTrailer} is not expected in this Stock Check.`, "error");
          return;
        }

        showScanNotice("Unexpected response from server.", "error");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to mark trailer as present.";
        showScanNotice(message, "error");
      } finally {
        setIsMarking(false);
        setActiveMarkingTrailer(null);
      }
    },
    [isMarking, items, openStockCheck, showScanNotice],
  );

  const handleScanSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = normalizeTrailerNumber(scanValue);
    if (!normalized) {
      setScanValue("");
      setScanNotice(null);
      if (scanInputRef.current) {
        scanInputRef.current.focus();
      }
      return;
    }

    await markTrailerPresent(normalized, "scan");

    setScanValue("");
    if (scanInputRef.current) {
      scanInputRef.current.focus();
    }
  };

  const handleMarkPresentClick = async (item: StockCheckItem) => {
    const trailerNumber = normalizeTrailerNumber(item.trailer_number ?? "");
    if (!trailerNumber) {
      showScanNotice("Trailer number is missing for this row.", "warning");
      return;
    }

    await markTrailerPresent(trailerNumber, "button");
  };

  const openLoadStatusChange = (item: StockCheckItem) => {
    if (!item.trailer_id) {
      showScanNotice("This trailer cannot be changed because it has no linked trailer record.", "warning");
      return;
    }

    const currentStatus = getLoadStatusValue(item.system_load_status);
    if (!currentStatus) {
      showScanNotice("Load status must be Empty or Loaded to use this action.", "warning");
      return;
    }

    setPendingLoadStatusChange({
      stockCheckItemId: item.id,
      trailerNumber: item.trailer_number ?? "Unknown",
      currentStatus,
      newStatus: currentStatus === "empty" ? "loaded" : "empty",
    });
  };

  const openPositionChange = (item: StockCheckItem) => {
    if (!item.trailer_id) {
      showScanNotice("This trailer cannot be changed because it has no linked trailer record.", "warning");
      return;
    }

    const currentSystemPosition = normalizePositionDisplay(item.expected_position);
    const expectedPosition = normalizePositionDisplay(item.expected_position);

    setPendingPositionChange({
      stockCheckItemId: item.id,
      trailerNumber: item.trailer_number ?? "Unknown",
      currentSystemPosition,
      expectedPosition,
      enteredPosition: "",
    });
  };

  const handleConfirmLoadStatusChange = async () => {
    if (!pendingLoadStatusChange) {
      return;
    }

    if (!openStockCheck?.id) {
      showScanNotice("Stock check not found. Refresh the page and try again.", "error");
      setPendingLoadStatusChange(null);
      return;
    }

    const targetItem = items.find((item) => item.id === pendingLoadStatusChange.stockCheckItemId);
    if (!targetItem) {
      showScanNotice("Stock check item not found. Refresh and try again.", "error");
      setPendingLoadStatusChange(null);
      return;
    }

    if (!targetItem.trailer_id) {
      showScanNotice("This trailer cannot be changed because it has no linked trailer record.", "warning");
      setPendingLoadStatusChange(null);
      return;
    }

    if (isChangingLoadStatus) {
      return;
    }

    setIsChangingLoadStatus(true);
    setActiveLoadStatusItemId(pendingLoadStatusChange.stockCheckItemId);
    setPageError(null);

    try {
      const operatorName = await resolveOperatorName();

      const { data, error } = await supabase.rpc("change_stock_check_trailer_load_status", {
        p_stock_check_id: openStockCheck.id,
        p_stock_check_item_id: pendingLoadStatusChange.stockCheckItemId,
        p_new_load_status: pendingLoadStatusChange.newStatus,
        p_changed_by: operatorName,
      });

      if (error) {
        throw new Error(mapChangeLoadStatusErrorMessage(error.message));
      }

      const rpcRow = extractChangeLoadStatusRpcRow(data);
      if (!rpcRow) {
        throw new Error("No response was returned. Please try again.");
      }

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (item.id !== rpcRow.stock_check_item_id) {
            return item;
          }

          return {
            ...item,
            system_load_status: rpcRow.new_load_status,
            discrepancy_type: rpcRow.discrepancy_type,
            resolution_status: rpcRow.resolution_status ?? item.resolution_status,
          };
        }),
      );

      const beforeLabel = getLoadStatusLabel(rpcRow.previous_load_status);
      const afterLabel = getLoadStatusLabel(rpcRow.new_load_status);

      await logTrailerEvent({
        trailerId: rpcRow.trailer_id,
        trailerNumber: rpcRow.trailer_number,
        eventType: "stock_check_change_load_status",
        description: "Load status changed from stock check reconciliation.",
        previousValue: {
          stock_check_id: openStockCheck.id,
          stock_check_item_id: rpcRow.stock_check_item_id,
          load_status: rpcRow.previous_load_status,
        },
        newValue: {
          stock_check_id: openStockCheck.id,
          stock_check_item_id: rpcRow.stock_check_item_id,
          load_status: rpcRow.new_load_status,
          discrepancy_type: rpcRow.discrepancy_type,
          resolution_status: rpcRow.resolution_status,
        },
        sourceModule: "stock_check",
        performedBy: operatorName,
      });

      try {
        await createTrailerActivity({
          trailerId: rpcRow.trailer_id,
          trailerNumber: rpcRow.trailer_number,
          eventType: "load_status_changed",
          eventTitle: "Load status changed",
          eventDescription: "Load status changed from stock check reconciliation.",
          sourceModule: "stock_check",
          sourceRecordId: rpcRow.stock_check_item_id,
          previousStatus: rpcRow.previous_load_status,
          newStatus: rpcRow.new_load_status,
          metadata: {
            stock_check_id: openStockCheck.id,
            stock_check_item_id: rpcRow.stock_check_item_id,
            discrepancy_type: rpcRow.discrepancy_type,
            resolution_status: rpcRow.resolution_status,
          },
          performedBy: operatorName,
        });
      } catch (activityError) {
        console.error("Unable to log trailer activity for stock check load status change:", activityError);
      }

      setActionNotice(`${normalizeTrailerNumber(rpcRow.trailer_number)} changed from ${beforeLabel} to ${afterLabel}.`);
      showScanNotice("Operational correction applied.", "info");
      setPendingLoadStatusChange(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change trailer load status.";
      showScanNotice(message, "error");
    } finally {
      setIsChangingLoadStatus(false);
      setActiveLoadStatusItemId(null);
    }
  };

  const handleConfirmPositionChange = async (newPositionInput: string) => {
    if (!pendingPositionChange) {
      return;
    }

    const trimmedPosition = newPositionInput.trim().toUpperCase();
    if (!trimmedPosition) {
      showScanNotice("New actual position is required.", "warning");
      return;
    }

    if (!openStockCheck?.id) {
      showScanNotice("Stock check not found. Refresh the page and try again.", "error");
      setPendingPositionChange(null);
      return;
    }

    const targetItem = items.find((item) => item.id === pendingPositionChange.stockCheckItemId);
    if (!targetItem) {
      showScanNotice("Stock check item not found. Refresh and try again.", "error");
      setPendingPositionChange(null);
      return;
    }

    if (!targetItem.trailer_id) {
      showScanNotice("This trailer cannot be changed because it has no linked trailer record.", "warning");
      setPendingPositionChange(null);
      return;
    }

    if (isChangingPosition) {
      return;
    }

    setIsChangingPosition(true);
    setActivePositionItemId(pendingPositionChange.stockCheckItemId);
    setPageError(null);

    try {
      const operatorName = await resolveOperatorName();

      const { data, error } = await supabase.rpc("change_stock_check_trailer_position", {
        p_stock_check_id: openStockCheck.id,
        p_stock_check_item_id: pendingPositionChange.stockCheckItemId,
        p_new_position: trimmedPosition,
        p_changed_by: operatorName,
      });

      if (error) {
        throw new Error(mapChangePositionErrorMessage(error.message));
      }

      const rpcRow = extractChangePositionRpcRow(data);
      if (!rpcRow) {
        throw new Error("No response was returned. Please try again.");
      }

      setItems((currentItems) =>
        currentItems.map((item) => {
          if (item.id !== rpcRow.stock_check_item_id) {
            return item;
          }

          return {
            ...item,
            actual_position: rpcRow.new_position,
            discrepancy_type: rpcRow.discrepancy_type,
            resolution_status: rpcRow.resolution_status ?? item.resolution_status,
          };
        }),
      );

      const previousPosition = normalizePositionDisplay(rpcRow.previous_position);
      const newPosition = normalizePositionDisplay(rpcRow.new_position);
      const trailerNumber = normalizeTrailerNumber(rpcRow.trailer_number);

      if (previousPosition === newPosition) {
        setActionNotice(`${trailerNumber} position confirmed as ${newPosition}.`);
      } else {
        setActionNotice(`${trailerNumber} moved from ${previousPosition} to ${newPosition}.`);
      }

      await logTrailerEvent({
        trailerId: rpcRow.trailer_id,
        trailerNumber: rpcRow.trailer_number,
        eventType: "stock_check_change_position",
        description: "Compound position changed from stock check reconciliation.",
        previousValue: {
          stock_check_id: openStockCheck.id,
          stock_check_item_id: rpcRow.stock_check_item_id,
          compound_position: rpcRow.previous_position,
        },
        newValue: {
          stock_check_id: openStockCheck.id,
          stock_check_item_id: rpcRow.stock_check_item_id,
          compound_position: rpcRow.new_position,
          discrepancy_type: rpcRow.discrepancy_type,
          resolution_status: rpcRow.resolution_status,
        },
        sourceModule: "stock_check",
        performedBy: operatorName,
      });

      try {
        await createTrailerActivity({
          trailerId: rpcRow.trailer_id,
          trailerNumber: rpcRow.trailer_number,
          eventType: "compound_position_changed",
          eventTitle: "Compound position changed",
          eventDescription: "Compound position changed from stock check reconciliation.",
          sourceModule: "stock_check",
          sourceRecordId: rpcRow.stock_check_item_id,
          previousCompoundPosition: rpcRow.previous_position,
          newCompoundPosition: rpcRow.new_position,
          metadata: {
            stock_check_id: openStockCheck.id,
            stock_check_item_id: rpcRow.stock_check_item_id,
            discrepancy_type: rpcRow.discrepancy_type,
            resolution_status: rpcRow.resolution_status,
          },
          performedBy: operatorName,
        });
      } catch (activityError) {
        console.error("Unable to log trailer activity for stock check position change:", activityError);
      }

      showScanNotice("Operational position correction applied.", "info");
      setPendingPositionChange(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to change trailer position.";
      showScanNotice(message, "error");
    } finally {
      setIsChangingPosition(false);
      setActivePositionItemId(null);
    }
  };

  const reviewDiscrepancyItems = useMemo(
    () => items.filter((item) => Boolean(item.resolution_action?.trim())),
    [items],
  );

  const stats = useMemo(() => {
    const expected = openStockCheck?.expected_total ?? 0;
    const checked = openStockCheck?.checked_total ?? 0;
    const found = openStockCheck?.present_total ?? 0;
    const remaining = Math.max(remainingTotal ?? expected - checked, 0);

    return { expected, checked, found, remaining };
  }, [openStockCheck, remainingTotal]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Compound"
        title="Compound Stock Check"
        description="Validate expected compound trailers against physical presence using a single operational stock check snapshot."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isLoading || isRefreshing || isStarting}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            {!openStockCheck ? (
              <button
                type="button"
                onClick={() => void handleStartStockCheck()}
                disabled={isStarting || isLoading}
                className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStarting ? "Starting..." : "Start Stock Check"}
              </button>
            ) : null}
          </div>
        }
      />

      {pageError ? (
        <AlertCard title="Unable to load stock check" description={pageError} tone="critical" />
      ) : null}

      {actionNotice ? (
        <AppCard className="border border-emerald-200 bg-emerald-50">
          <div className="px-4 py-3 text-sm text-emerald-800">{actionNotice}</div>
        </AppCard>
      ) : null}

      {isLoading ? <LoadingState label="Loading compound stock check..." /> : null}

      {!isLoading && !openStockCheck ? (
        <>
          <EmptyState
            title="No stock check is currently in progress"
            description="Start a stock check to capture the current expected trailers in compound and begin scanning trailer numbers."
            action={
              <button
                type="button"
                onClick={() => void handleStartStockCheck()}
                disabled={isStarting}
                className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStarting ? "Starting..." : "Start Stock Check"}
              </button>
            }
          />

          <AppCard>
            <div className="p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">Recent Stock Checks</h2>
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Last 10</span>
              </div>

              {recentChecks.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No previous stock checks found.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <th className="px-2 py-3 font-semibold">Date</th>
                        <th className="px-2 py-3 font-semibold">Started By</th>
                        <th className="px-2 py-3 font-semibold">Expected</th>
                        <th className="px-2 py-3 font-semibold">Found</th>
                        <th className="px-2 py-3 font-semibold">Missing</th>
                        <th className="px-2 py-3 font-semibold">Status</th>
                        <th className="px-2 py-3 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentChecks.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="px-2 py-3">{formatDateTime(row.started_at)}</td>
                          <td className="px-2 py-3">{row.started_by ?? "-"}</td>
                          <td className="px-2 py-3">{row.expected_total ?? 0}</td>
                          <td className="px-2 py-3">{row.present_total ?? 0}</td>
                          <td className="px-2 py-3">{row.missing_total ?? 0}</td>
                          <td className="px-2 py-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClassName(row.status)}`}>
                              {formatStatusLabel(row.status)}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            {(row.status === "in_progress" || row.status === "completed") ? (
                              <button
                                type="button"
                                onClick={() => void handleReviewStockCheck(row)}
                                disabled={isRefreshing || isMarking || isChangingLoadStatus}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Review
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </AppCard>
        </>
      ) : null}

      {!isLoading && openStockCheck ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Expected" value={String(stats.expected)} />
            <StatCard label="Checked" value={String(stats.checked)} />
            <StatCard label="Found" value={String(stats.found)} />
            <StatCard label="Remaining" value={String(stats.remaining)} />
          </section>

          <AppCard>
            <div className="p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <dl className="grid gap-x-6 gap-y-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Started At</dt>
                    <dd className="mt-1 text-slate-900">{formatDateTime(openStockCheck.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Started By</dt>
                    <dd className="mt-1 text-slate-900">{openStockCheck.started_by ?? "-"}</dd>
                  </div>
                </dl>
                <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${getStatusBadgeClassName(openStockCheck.status)}`}>
                  {formatStatusLabel(openStockCheck.status).toUpperCase()}
                </span>
              </div>
              <p className="mt-4 text-sm text-slate-600">Operational correction mode: load status changes update the trailer record in TrailerHub.</p>
            </div>
          </AppCard>

          <AppCard>
            <div className="p-5 md:p-6">
              <h2 className="text-base font-semibold text-slate-950">Quick Trailer Check</h2>
              <p className="mt-1 text-sm text-slate-500">Search trailer numbers continuously using barcode scanner input or keyboard.</p>

              <form onSubmit={handleScanSubmit} className="mt-4">
                <input
                  ref={scanInputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value.toUpperCase())}
                  placeholder="Enter or scan trailer number"
                  disabled={isMarking}
                  aria-label="Enter or scan trailer number"
                  className="w-full rounded-2xl border-2 border-emerald-200 bg-white px-4 py-3 text-base font-semibold tracking-[0.04em] text-slate-900 outline-none transition focus:border-emerald-400"
                />
              </form>

              {scanNotice ? (
                <p
                  aria-live="polite"
                  className={`mt-3 text-sm font-medium ${
                    scanNoticeTone === "success"
                      ? "text-emerald-700"
                      : scanNoticeTone === "error"
                        ? "text-rose-700"
                        : scanNoticeTone === "warning"
                          ? "text-amber-700"
                          : "text-slate-700"
                  }`}
                >
                  {scanNotice}
                </p>
              ) : null}
            </div>
          </AppCard>

          <AppCard>
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Expected Trailers</h2>
              <p className="mt-1 text-sm text-slate-500">Snapshot items ordered by expected position and trailer number.</p>

              {items.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No expected trailers were loaded for this stock check.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <th className="px-2 py-3 font-semibold">Trailer</th>
                        <th className="px-2 py-3 font-semibold">Expected Position</th>
                        <th className="px-2 py-3 font-semibold">Load Status</th>
                        <th className="px-2 py-3 font-semibold">Operational Status</th>
                        <th className="px-2 py-3 font-semibold">Check Status</th>
                        <th className="px-2 py-3 font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const normalizedItemTrailer = normalizeTrailerNumber(item.trailer_number ?? "");
                        const isPresent = item.physically_present === true;
                        const isMissing = item.physically_present === false;
                        const isCurrentAction = isMarking && activeMarkingTrailer === normalizedItemTrailer;
                        const isHighlighted = highlightedItemId === item.id;

                        return (
                        <tr
                          key={item.id}
                          id={`stock-check-item-${item.id}`}
                          ref={(element) => {
                            tableRowRefs.current[item.id] = element;
                          }}
                          className={`border-b border-slate-100 align-top transition-colors last:border-b-0 ${
                            isPresent ? "bg-emerald-50/60" : ""
                          } ${isHighlighted ? "ring-2 ring-emerald-300" : ""}`}
                        >
                          <td className="px-2 py-3 font-semibold text-slate-900">{item.trailer_number ?? "-"}</td>
                          <td className="px-2 py-3">
                            <div className="space-y-2">
                              <div className="text-xs text-slate-500">Expected Position</div>
                              <div className="font-semibold text-slate-900">{normalizePositionDisplay(item.expected_position)}</div>
                              <div className="text-xs text-slate-500">Actual Position</div>
                              <div className="font-medium text-slate-800">{normalizePositionDisplay(item.actual_position)}</div>
                              {isPositionResolved(item) ? (
                                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                  Position Resolved
                                </span>
                              ) : null}
                              {item.trailer_id ? (
                                <button
                                  type="button"
                                  onClick={() => openPositionChange(item)}
                                  disabled={isChangingPosition || isChangingLoadStatus || isMarking}
                                  aria-label={`Change position for trailer ${item.trailer_number ?? "unknown"}`}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {activePositionItemId === item.id && isChangingPosition ? "Changing..." : "Change Position"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getLoadStatusBadgeClassName(item.system_load_status)}`}>
                                {getLoadStatusLabel(item.system_load_status)}
                              </span>
                              {item.trailer_id ? (
                                <button
                                  type="button"
                                  onClick={() => openLoadStatusChange(item)}
                                  disabled={isChangingLoadStatus || isMarking || isChangingPosition}
                                  aria-label={`Change load status for trailer ${item.trailer_number ?? "unknown"}`}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {activeLoadStatusItemId === item.id && isChangingLoadStatus ? "Changing..." : "Change"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-3">{formatStatusLabel(item.system_operational_status)}</td>
                          <td className="px-2 py-3">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getCheckStatusBadgeClassName(item.physically_present)}`}>
                              {getCheckStatusLabel(item.physically_present)}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            {isPresent ? (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                Present
                              </span>
                            ) : isMissing ? (
                              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">
                                Missing
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleMarkPresentClick(item)}
                                disabled={isMarking || isChangingPosition}
                                aria-label={`Mark trailer ${item.trailer_number ?? "unknown"} as present`}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {isCurrentAction ? "Marking..." : "Mark Present"}
                              </button>
                            )}
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </AppCard>

          <AppCard>
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Review Discrepancies</h2>
              <p className="mt-1 text-sm text-slate-500">Resolution details for corrected trailer discrepancies.</p>

              {reviewDiscrepancyItems.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No resolved discrepancy actions recorded yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.2em] text-slate-500">
                        <th className="px-2 py-3 font-semibold">Trailer</th>
                        <th className="px-2 py-3 font-semibold">Expected Position</th>
                        <th className="px-2 py-3 font-semibold">Actual Position</th>
                        <th className="px-2 py-3 font-semibold">Resolution</th>
                        <th className="px-2 py-3 font-semibold">Resolved At</th>
                        <th className="px-2 py-3 font-semibold">Resolved By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewDiscrepancyItems.map((item) => (
                        <tr key={`review-${item.id}`} className="border-b border-slate-100 align-top last:border-b-0">
                          <td className="px-2 py-3 font-semibold text-slate-900">{item.trailer_number ?? "-"}</td>
                          <td className="px-2 py-3">{normalizePositionDisplay(item.expected_position)}</td>
                          <td className="px-2 py-3">{normalizePositionDisplay(item.actual_position)}</td>
                          <td className="px-2 py-3">
                            <div className="space-y-1">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Resolution</p>
                              <p>{item.resolution_action ?? "-"}</p>
                              <p className="text-xs text-slate-500">{formatStatusLabel(item.discrepancy_type)}</p>
                              {item.resolution_status ? (
                                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                  {formatStatusLabel(item.resolution_status)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-3">{formatDateTime(item.resolved_at)}</td>
                          <td className="px-2 py-3">{item.resolved_by ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </AppCard>
        </>
      ) : null}

      {pendingLoadStatusChange ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4" role="dialog" aria-modal="true" aria-label="Confirm load status change">
          <AppCard className="w-full max-w-lg">
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Confirm Operational Correction</h2>
              <p className="mt-3 text-sm text-slate-600">This will update the trailer's current load status in TrailerHub.</p>

              <dl className="mt-4 grid gap-3 text-sm text-slate-700">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Trailer</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{normalizeTrailerNumber(pendingLoadStatusChange.trailerNumber)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Status</dt>
                  <dd className="mt-1">{pendingLoadStatusChange.currentStatus === "empty" ? "Empty" : "Loaded"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">New Status</dt>
                  <dd className="mt-1">{pendingLoadStatusChange.newStatus === "empty" ? "Empty" : "Loaded"}</dd>
                </div>
              </dl>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingLoadStatusChange(null)}
                  disabled={isChangingLoadStatus}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmLoadStatusChange()}
                  disabled={isChangingLoadStatus}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChangingLoadStatus ? "Changing..." : "Confirm Change"}
                </button>
              </div>
            </div>
          </AppCard>
        </div>
      ) : null}

      {pendingPositionChange ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4" role="dialog" aria-modal="true" aria-label="Change trailer position">
          <AppCard className="w-full max-w-lg">
            <div className="p-5 md:p-6">
              <h2 className="text-lg font-semibold text-slate-950">Change Trailer Position</h2>

              <dl className="mt-4 grid gap-3 text-sm text-slate-700">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Trailer</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{normalizeTrailerNumber(pendingPositionChange.trailerNumber)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current system position</dt>
                  <dd className="mt-1">{pendingPositionChange.currentSystemPosition}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expected position</dt>
                  <dd className="mt-1">{pendingPositionChange.expectedPosition}</dd>
                </div>
                <div>
                  <label htmlFor="newActualPosition" className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    New actual position
                  </label>
                  <input
                    id="newActualPosition"
                    value={pendingPositionChange.enteredPosition}
                    onChange={(event) => {
                      const nextValue = event.target.value.toUpperCase();
                      setPendingPositionChange((current) => (current ? { ...current, enteredPosition: nextValue } : current));
                    }}
                    placeholder="Example: 1, 01, P1, P01"
                    disabled={isChangingPosition}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base font-semibold tracking-[0.03em] text-slate-900 outline-none transition focus:border-cyan-500"
                  />
                </div>
              </dl>

              <p className="mt-4 text-sm text-slate-600">This will update the trailer's current compound position in TrailerHub.</p>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingPositionChange(null)}
                  disabled={isChangingPosition}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPositionChange(pendingPositionChange.currentSystemPosition)}
                  disabled={isChangingPosition || pendingPositionChange.currentSystemPosition === "-"}
                  className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Confirm Current Position
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPositionChange(pendingPositionChange.enteredPosition)}
                  disabled={isChangingPosition || pendingPositionChange.enteredPosition.trim().length === 0}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isChangingPosition ? "Changing..." : "Confirm Change"}
                </button>
              </div>
            </div>
          </AppCard>
        </div>
      ) : null}
    </div>
  );
}
