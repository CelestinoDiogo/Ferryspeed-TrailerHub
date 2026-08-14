"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { DRIVER_INSTRUCTION_PRESETS } from "@/lib/driver-instruction-presets";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { RoleKey } from "@/lib/auth/roles";
import { useOperationalRealtime } from "@/lib/realtime/operational-realtime";
import { supabase } from "@/lib/supabase";
import { getSessionToken, SESSION_EXPIRED_MESSAGE } from "@/lib/voice/session";

type DriverRow = {
  id: string;
  display_name: string;
  user_id: string | null;
};

type DriverAssignmentRow = {
  id: string;
  driver_id: string;
  trailer_id: string | null;
  booking_reference: string | null;
  status: string;
  delivery_date: string;
};

type DriverInstructionSummaryRow = {
  id: string;
  driver_id: string;
  read_at: string | null;
};

type DriverInstructionResponseRecord = {
  id: string;
  responseType: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me";
  message: string | null;
  createdAt: string;
  isException: boolean;
};

type DriverInstructionPriority = "normal" | "high" | "critical";

type DriverInstructionRecord = {
  id: string;
  deliveryBookingId: string | null;
  trailerId: string | null;
  trailerNumber: string | null;
  instruction: string;
  priority: DriverInstructionPriority;
  senderDisplayName: string | null;
  createdAt: string;
  readAt: string | null;
  latestResponse: DriverInstructionResponseRecord | null;
  responseHistory: DriverInstructionResponseRecord[];
};

type DriverTimelineEntry = {
  id: string;
  kind: "manager_instruction" | "driver_response";
  createdAt: string;
  actorLabel: string;
  text: string;
  isException: boolean;
};

type DriverInstructionContextFeed = {
  instructions: DriverInstructionRecord[];
  latestResponse: DriverInstructionResponseRecord | null;
  latestException: DriverInstructionResponseRecord | null;
  timeline: DriverTimelineEntry[];
};

type DriverSummary = {
  activeWorkCount: number;
  unreadCount: number;
  bookingCount: number;
};

type BookingStatusSummary = {
  bookingReference: string | null;
  status: string;
};

const INSTRUCTION_MAX_LENGTH = 180;
const AUTH_SESSION_ERROR_PATTERNS = [
  "invalid authentication token",
  "auth session missing",
  "missing authorization header",
  "authentication token did not resolve",
  "jwt",
];

const normalizeText = (value?: string | null) => value?.trim() ?? "";

const toResponseLabel = (value: "ok" | "completed" | "arrived" | "delayed" | "problem" | "call_me") => {
  if (value === "call_me") {
    return "CALL ME";
  }

  return value.toUpperCase();
};

const priorityLabels: Array<{ value: DriverInstructionPriority; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Attention" },
  { value: "critical", label: "Critical" },
];

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const toStatusLabel = (value: string) => value.split("_").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");

const isActiveWorkStatus = (value: string) => {
  const normalized = normalizeText(value).toLowerCase();
  return normalized !== "cancelled" && normalized !== "collected" && normalized !== "delivered";
};

const isAuthSessionError = (message: string) => {
  const normalized = message.toLowerCase();
  return AUTH_SESSION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const toUserFacingError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : fallback;

  if (isAuthSessionError(message)) {
    return SESSION_EXPIRED_MESSAGE;
  }

  return message || fallback;
};

const fetchDriverInstructionsJson = async <T,>(input: string, init?: RequestInit): Promise<T> => {
  const token = await getSessionToken();

  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    const errorMessage = payload.error ?? "Unable to complete driver communications request.";

    if (response.status === 401 || isAuthSessionError(errorMessage)) {
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }

    throw new Error(errorMessage);
  }

  return payload;
};

const readDriverContextFeed = async (
  driverId: string,
  context?: { deliveryBookingId?: string; trailerId?: string },
): Promise<DriverInstructionContextFeed> => {
  const query = new URLSearchParams({
    driverId,
    limit: "60",
  });

  if (context?.deliveryBookingId) {
    query.set("deliveryBookingId", context.deliveryBookingId);
  }

  if (context?.trailerId) {
    query.set("trailerId", context.trailerId);
  }

  const payload = await fetchDriverInstructionsJson<DriverInstructionContextFeed>(`/api/operations/driver-instructions?${query.toString()}`, {
    method: "GET",
  });

  return {
    instructions: Array.isArray(payload.instructions) ? payload.instructions : [],
    latestResponse: payload.latestResponse ?? null,
    latestException: payload.latestException ?? null,
    timeline: Array.isArray(payload.timeline) ? payload.timeline : [],
  };
};

export function DriverCommunicationsPanel() {
  const searchParams = useSearchParams();
  const { roleKey } = useCurrentUser();
  const desktopRoleKey = roleKey as RoleKey | null;

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driverSummaries, setDriverSummaries] = useState<Record<string, DriverSummary>>({});
  const [bookingStatusById, setBookingStatusById] = useState<Record<string, BookingStatusSummary>>({});
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [historyFeed, setHistoryFeed] = useState<DriverInstructionContextFeed>({
    instructions: [],
    latestResponse: null,
    latestException: null,
    timeline: [],
  });
  const [composerText, setComposerText] = useState("");
  const [composerPriority, setComposerPriority] = useState<DriverInstructionPriority>("normal");
  const [searchText, setSearchText] = useState("");
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const initialDriverId = searchParams.get("driverId");
  const contextDeliveryBookingId = searchParams.get("deliveryBookingId") ?? undefined;
  const contextTrailerId = searchParams.get("trailerId") ?? undefined;
  const contextTrailerNumber = searchParams.get("trailerNumber") ?? undefined;
  const contextBookingReference = searchParams.get("bookingReference") ?? undefined;

  const contextMatchesSelection = selectedDriverId && initialDriverId && selectedDriverId === initialDriverId;

  const loadDriverIndex = useCallback(async (withLoading: boolean) => {
    if (withLoading) {
      setIsLoadingDrivers(true);
    }

    try {
      const [driverResult, bookingResult, instructionResult] = await Promise.all([
        supabase
          .from("drivers")
          .select("id,display_name,user_id")
          .eq("active", true)
          .order("display_name", { ascending: true }),
        supabase
          .from("delivery_bookings")
          .select("id,driver_id,trailer_id,booking_reference,status,delivery_date")
          .not("driver_id", "is", null)
          .neq("status", "cancelled")
          .order("delivery_date", { ascending: false })
          .limit(900),
        supabase
          .from("driver_operational_instructions")
          .select("id,driver_id,read_at")
          .order("created_at", { ascending: false })
          .limit(1400),
      ]);

      if (driverResult.error) {
        throw driverResult.error;
      }

      if (bookingResult.error) {
        throw bookingResult.error;
      }

      if (instructionResult.error) {
        throw instructionResult.error;
      }

      const nextDrivers = (driverResult.data ?? []) as DriverRow[];
      const bookingRows = (bookingResult.data ?? []) as DriverAssignmentRow[];
      const instructionRows = (instructionResult.data ?? []) as DriverInstructionSummaryRow[];

      const summaryByDriverId: Record<string, DriverSummary> = {};
      const nextBookingStatusById: Record<string, BookingStatusSummary> = {};
      nextDrivers.forEach((driver) => {
        summaryByDriverId[driver.id] = {
          activeWorkCount: 0,
          unreadCount: 0,
          bookingCount: 0,
        };
      });

      bookingRows.forEach((row) => {
        const summary = summaryByDriverId[row.driver_id];
        if (!summary) {
          return;
        }

        nextBookingStatusById[row.id] = {
          bookingReference: row.booking_reference,
          status: row.status,
        };

        summary.bookingCount += 1;
        if (isActiveWorkStatus(row.status)) {
          summary.activeWorkCount += 1;
        }
      });

      instructionRows.forEach((row) => {
        const summary = summaryByDriverId[row.driver_id];
        if (!summary) {
          return;
        }

        if (!row.read_at) {
          summary.unreadCount += 1;
        }
      });

      setDrivers(nextDrivers);
      setDriverSummaries(summaryByDriverId);
  setBookingStatusById(nextBookingStatusById);

      setSelectedDriverId((current) => {
        if (current && nextDrivers.some((driver) => driver.id === current)) {
          return current;
        }

        if (initialDriverId && nextDrivers.some((driver) => driver.id === initialDriverId)) {
          return initialDriverId;
        }

        return nextDrivers[0]?.id ?? null;
      });
    } catch (loadErr) {
      setError(loadErr instanceof Error ? loadErr.message : "Unable to load active drivers.");
      setDrivers([]);
      setDriverSummaries({});
      setBookingStatusById({});
      setSelectedDriverId(null);
    } finally {
      if (withLoading) {
        setIsLoadingDrivers(false);
      }
    }
  }, [initialDriverId]);

  const loadHistory = useCallback(async (driverId: string, withLoading: boolean) => {
    if (withLoading) {
      setIsLoadingHistory(true);
    }

    try {
      const feed = await readDriverContextFeed(
        driverId,
        contextMatchesSelection
          ? {
              deliveryBookingId: contextDeliveryBookingId,
              trailerId: contextTrailerId,
            }
          : undefined,
      );
      setHistoryFeed(feed);
    } catch (loadErr) {
      setError(toUserFacingError(loadErr, "Unable to load communication history."));
      setHistoryFeed({
        instructions: [],
        latestResponse: null,
        latestException: null,
        timeline: [],
      });
    } finally {
      if (withLoading) {
        setIsLoadingHistory(false);
      }
    }
  }, [contextDeliveryBookingId, contextMatchesSelection, contextTrailerId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadDriverIndex(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDriverIndex]);

  useEffect(() => {
    if (!selectedDriverId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadHistory(selectedDriverId, true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadHistory, selectedDriverId]);

  useOperationalRealtime(["dashboard"], () => {
    void loadDriverIndex(false);
    if (selectedDriverId) {
      void loadHistory(selectedDriverId, false);
    }
  }, { debounceMs: 700 });

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  );

  const filteredDrivers = useMemo(() => {
    const normalized = searchText.trim().toLowerCase();
    if (!normalized) {
      return drivers;
    }

    return drivers.filter((driver) => driver.display_name.toLowerCase().includes(normalized));
  }, [drivers, searchText]);

  const appendPreset = useCallback((preset: string) => {
    setComposerText((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed} ${preset}` : preset;
    });
  }, []);

  const sendMessage = useCallback(async () => {
    if (!selectedDriver) {
      return;
    }

    const message = composerText.trim();
    if (!message) {
      setError("Instruction text is required.");
      return;
    }

    setIsSending(true);
    setError(null);
    setSuccess(null);

    try {
      const payload: {
        driverId: string;
        instruction: string;
        deliveryBookingId?: string;
        trailerId?: string;
        trailerNumber?: string;
        priority: DriverInstructionPriority;
      } = {
        driverId: selectedDriver.id,
        instruction: message,
        priority: composerPriority,
      };

      if (contextMatchesSelection && contextDeliveryBookingId) {
        payload.deliveryBookingId = contextDeliveryBookingId;
      }

      if (contextMatchesSelection && contextTrailerId) {
        payload.trailerId = contextTrailerId;
      }

      if (contextMatchesSelection && contextTrailerNumber) {
        payload.trailerNumber = contextTrailerNumber;
      }

      await fetchDriverInstructionsJson<{ ok: boolean; error?: string }>("/api/operations/driver-instructions", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setComposerText("");
      setSuccess("Instruction sent.");
      await loadHistory(selectedDriver.id, false);
      await loadDriverIndex(false);
    } catch (sendErr) {
      setError(toUserFacingError(sendErr, "Unable to send instruction."));
    } finally {
      setIsSending(false);
    }
  }, [composerPriority, composerText, contextDeliveryBookingId, contextMatchesSelection, contextTrailerId, contextTrailerNumber, loadDriverIndex, loadHistory, selectedDriver]);

  return (
    <PermissionGuard
      roleKey={desktopRoleKey}
      moduleKey="dashboard"
      action="view"
      allowWhenRoleMissing={false}
      fallback={
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
          <h2 className="text-xl font-semibold">Access denied</h2>
          <p className="mt-2 text-sm">You do not have permission to access Driver Communications.</p>
        </div>
      }
    >
      <section className="rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm md:p-6">
        <div className="mb-4 flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Operations Control</p>
          <h1 className="text-2xl font-semibold text-slate-950">Driver Communications</h1>
          <p className="text-sm text-slate-600">Desktop channel for Manager-to-Driver messaging using Sprint 3 instructions and response events.</p>
        </div>

        {error ? <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
        {success ? <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div> : null}

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-600" htmlFor="driver-search">Active Drivers</label>
            <input
              id="driver-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Find driver"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />

            {isLoadingDrivers ? <p className="mt-3 text-sm text-slate-500">Loading drivers...</p> : null}

            <div className="mt-3 space-y-2">
              {filteredDrivers.map((driver) => {
                const summary = driverSummaries[driver.id] ?? { activeWorkCount: 0, unreadCount: 0, bookingCount: 0 };
                const active = selectedDriverId === driver.id;

                return (
                  <button
                    key={driver.id}
                    type="button"
                    onClick={() => {
                      setSelectedDriverId(driver.id);
                      setError(null);
                      setSuccess(null);
                    }}
                    className={`w-full rounded-xl border px-3 py-2 text-left ${active ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{driver.display_name}</p>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-600">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">Active</span>
                      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5">Work {summary.activeWorkCount}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${summary.unreadCount > 0 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-100"}`}>
                        Pending {summary.unreadCount}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            {!selectedDriver ? <p className="text-sm text-slate-500">Select a driver to view communications.</p> : null}

            {selectedDriver ? (
              <>
                <div className="border-b border-slate-200 pb-3">
                  <h2 className="text-xl font-semibold text-slate-950">{selectedDriver.display_name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Active jobs: {driverSummaries[selectedDriver.id]?.activeWorkCount ?? 0} • Assigned bookings: {driverSummaries[selectedDriver.id]?.bookingCount ?? 0}
                  </p>
                  {contextMatchesSelection ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Context: {contextBookingReference ? `Booking ${contextBookingReference}` : "Delivery"}
                      {contextTrailerNumber ? ` • Trailer ${contextTrailerNumber}` : ""}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">Message Composer</p>
                  <textarea
                    value={composerText}
                    onChange={(event) => setComposerText(event.target.value.slice(0, INSTRUCTION_MAX_LENGTH))}
                    placeholder="Type message or operational instruction"
                    className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Message priority">
                    {priorityLabels.map((priority) => (
                      <button
                        key={priority.value}
                        type="button"
                        aria-pressed={composerPriority === priority.value}
                        onClick={() => setComposerPriority(priority.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${composerPriority === priority.value
                          ? priority.value === "critical" ? "border-rose-500 bg-rose-100 text-rose-900" : priority.value === "high" ? "border-amber-500 bg-amber-100 text-amber-900" : "border-cyan-500 bg-cyan-100 text-cyan-900"
                          : "border-slate-300 bg-white text-slate-700"}`}
                      >
                        {priority.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {DRIVER_INSTRUCTION_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => appendPreset(preset)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs text-slate-500">{composerText.length}/{INSTRUCTION_MAX_LENGTH}</p>
                    <button
                      type="button"
                      onClick={() => {
                        void sendMessage();
                      }}
                      disabled={isSending || composerText.trim().length === 0}
                      className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-cyan-300"
                    >
                      {isSending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">Conversation Timeline</p>
                    {isLoadingHistory ? <p className="mt-2 text-sm text-slate-500">Loading history...</p> : null}
                    {!isLoadingHistory && historyFeed.timeline.length === 0 ? <p className="mt-2 text-sm text-slate-500">No communication history yet.</p> : null}
                    <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {historyFeed.timeline.map((entry) => (
                        <article
                          key={entry.id}
                          className={`rounded-xl border px-3 py-2 ${entry.kind === "manager_instruction" ? "border-cyan-200 bg-cyan-50" : entry.isException ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">{entry.kind === "manager_instruction" ? "Manager" : "Driver"}</p>
                          <p className="mt-1 text-sm text-slate-900">{entry.text}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{formatDateTime(entry.createdAt)}</p>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">Instruction Ledger</p>
                    {!isLoadingHistory && historyFeed.instructions.length === 0 ? <p className="mt-2 text-sm text-slate-500">No instructions yet.</p> : null}
                    <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {historyFeed.instructions.map((item) => (
                        <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-900">{item.instruction}</p>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${item.priority === "critical" ? "bg-rose-100 text-rose-800" : item.priority === "high" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>
                              {item.priority === "high" ? "Attention" : item.priority}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">
                            Sent {formatDateTime(item.createdAt)} • {item.readAt ? `Read ${formatDateTime(item.readAt)}` : "Read pending"}
                          </p>
                          {item.deliveryBookingId && bookingStatusById[item.deliveryBookingId] ? (
                            <p className="mt-1 text-[11px] font-semibold text-slate-700">
                              Job: {bookingStatusById[item.deliveryBookingId].bookingReference ? `${bookingStatusById[item.deliveryBookingId].bookingReference} • ` : ""}
                              {toStatusLabel(bookingStatusById[item.deliveryBookingId].status)}
                            </p>
                          ) : null}
                          {item.latestResponse ? (
                            <p className={`mt-1 text-xs font-semibold ${item.latestResponse.isException ? "text-rose-700" : "text-emerald-700"}`}>
                              Latest: {toResponseLabel(item.latestResponse.responseType)}
                              {item.latestResponse.message ? ` - ${item.latestResponse.message}` : ""}
                            </p>
                          ) : null}
                          {item.responseHistory.length > 0 ? (
                            <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white px-2 py-2">
                              {item.responseHistory.map((response) => (
                                <p key={response.id} className={`text-[11px] ${response.isException ? "text-rose-700" : "text-slate-700"}`}>
                                  {formatDateTime(response.createdAt)} • {toResponseLabel(response.responseType)}
                                  {response.message ? ` - ${response.message}` : ""}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </PermissionGuard>
  );
}
