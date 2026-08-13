"use client";

import { useEffect, useMemo, useState } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import type { RoleKey } from "@/lib/auth/roles";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import type { DriverMobileTask } from "@/lib/driver-mobile-service";
import { supabase } from "@/lib/supabase";
import { getSessionToken } from "@/lib/voice/session";

type PreviewDriver = { id: string; displayName: string };
type PreviewInstruction = {
  id: string;
  deliveryBookingId: string | null;
  trailerId: string | null;
  trailerNumber: string | null;
  instruction: string;
  priority: "normal" | "high" | "critical";
  createdAt: string;
  readAt: string | null;
};

type PreviewProps = { roleKey: Extract<RoleKey, "administrator" | "supervisor"> };

const statusLabel = (value: string) => value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const instructionMatchesTask = (instruction: PreviewInstruction, task: DriverMobileTask) =>
  instruction.deliveryBookingId === task.bookingId || instruction.trailerId === task.trailerId;

export function DriverMobilePreview({ roleKey }: PreviewProps) {
  const { fullName, email } = useCurrentUser();
  const [drivers, setDrivers] = useState<PreviewDriver[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<PreviewDriver | null>(null);
  const [tasks, setTasks] = useState<DriverMobileTask[]>([]);
  const [instructions, setInstructions] = useState<PreviewInstruction[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadDrivers = async () => {
      try {
        const token = await getSessionToken();
        const response = await fetch("/api/driver-mobile/preview-drivers", { headers: { Authorization: `Bearer ${token}` } });
        const payload = (await response.json().catch(() => ({}))) as { drivers?: PreviewDriver[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Unable to load active Drivers.");
        if (!cancelled) setDrivers(Array.isArray(payload.drivers) ? payload.drivers : []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load active Drivers.");
      } finally {
        if (!cancelled) setLoadingDrivers(false);
      }
    };
    void loadDrivers();
    return () => { cancelled = true; };
  }, []);

  const loadPreview = async (driverId: string) => {
    if (!driverId) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const token = await getSessionToken();
      const query = `previewDriverId=${encodeURIComponent(driverId)}`;
      const [taskResponse, instructionResponse] = await Promise.all([
        fetch(`/api/driver-mobile/tasks?${query}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/driver-mobile/instructions?limit=20&${query}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const taskPayload = (await taskResponse.json().catch(() => ({}))) as { driver?: { id: string; display_name: string }; tasks?: DriverMobileTask[]; error?: string };
      const instructionPayload = (await instructionResponse.json().catch(() => ({}))) as { recent?: PreviewInstruction[]; error?: string };
      if (!taskResponse.ok) throw new Error(taskPayload.error || "Unable to load preview jobs.");
      if (!instructionResponse.ok) throw new Error(instructionPayload.error || "Unable to load preview instructions.");

      setSelectedDriver({ id: taskPayload.driver?.id ?? driverId, displayName: taskPayload.driver?.display_name ?? drivers.find((item) => item.id === driverId)?.displayName ?? "Selected Driver" });
      setTasks(Array.isArray(taskPayload.tasks) ? taskPayload.tasks : []);
      setInstructions(Array.isArray(instructionPayload.recent) ? instructionPayload.recent : []);
      setDismissedAlertKeys([]);
    } catch (loadError) {
      setSelectedDriver(null);
      setTasks([]);
      setInstructions([]);
      setError(loadError instanceof Error ? loadError.message : "Unable to load Driver preview.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const grouped = useMemo(() => ({
    attention: tasks.filter((task) => task.nextAction === "ACKNOWLEDGED" || task.collectionAging?.level === "orange" || task.collectionAging?.level === "red" || instructions.some((instruction) => !instruction.readAt && instructionMatchesTask(instruction, task))),
    todo: tasks.filter((task) => task.group !== "completed" && (task.nextAction === "ACKNOWLEDGED" || task.nextAction === "COLLECTED")),
    progress: tasks.filter((task) => task.group !== "completed" && task.nextAction === "DELIVERED"),
    completed: tasks.filter((task) => task.group === "completed"),
  }), [instructions, tasks]);

  const overlayInstruction = instructions.find((instruction) => !instruction.readAt && !dismissedAlertKeys.includes(`instruction:${instruction.id}`)) ?? null;
  const overlayTask = tasks.find((task) => task.nextAction === "ACKNOWLEDGED" && !dismissedAlertKeys.includes(`task:${task.bookingId}`)) ?? null;
  const overlayCritical = overlayInstruction?.priority === "high" || overlayInstruction?.priority === "critical";

  const renderTasks = (title: string, items: DriverMobileTask[]) => (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[0.16em]">{title}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{items.length}</span></div>
      {items.length === 0 ? <p className="mt-3 text-sm text-slate-500">No jobs in this section.</p> : null}
      <div className="mt-3 space-y-3">{items.map((task) => (
        <article key={task.bookingId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase text-cyan-700">{task.taskKind}</p><h3 className="text-lg font-bold">{task.trailerNumber}</h3><p className="text-sm">{task.customer || "No customer"}</p><p className="text-xs text-slate-500">{task.location || "No location"}</p></div><span className="h-fit rounded-full bg-white px-2 py-1 text-xs">{statusLabel(task.status)}</span></div>
          {task.collectionAging ? <p className={`mt-3 rounded-lg border px-2 py-2 text-xs font-bold ${task.collectionAging.level === "red" ? "border-rose-300 bg-rose-50 text-rose-900" : task.collectionAging.level === "orange" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>{task.collectionAging.label} · {Math.floor(task.collectionAging.waitingHours)}h pending</p> : null}
          {task.temperature.required ? <p className="mt-3 text-xs font-bold uppercase text-cyan-900">Temperature required on collection</p> : null}
          <div className="mt-3 rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-3 text-center text-sm font-bold text-cyan-900">READ-ONLY PREVIEW</div>
        </article>
      ))}</div>
    </section>
  );

  return (
    <PermissionGuard roleKey={roleKey} moduleKey="driver_mobile" action="view">
      <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ecfeff_100%)] px-3 py-4 text-slate-950">
        <div className="mx-auto max-w-2xl space-y-4">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Ferryspeed Driver Mobile</p><h1 className="mt-2 text-2xl font-bold">Driver Mobile Preview</h1><p className="mt-1 text-sm text-slate-600">{fullName ?? email ?? "Operations User"} · {roleKey === "administrator" ? "Administrator" : "Supervisor"}</p></div><button type="button" onClick={() => { void supabase.auth.signOut(); }} aria-label="Sign out" className="h-10 rounded-xl border border-slate-300 px-3"><LogOut className="h-4 w-4" /></button></div></header>

          <section className="rounded-2xl border-2 border-cyan-500 bg-cyan-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.2em]">Admin Preview</p>
            {!selectedDriver ? <h2 className="mt-2 text-lg font-bold">Select a Driver to preview</h2> : <h2 className="mt-2 text-lg font-bold uppercase">Previewing Driver: {selectedDriver.displayName}</h2>}
            <label htmlFor="preview-driver" className="mt-3 block text-xs font-bold uppercase">Active Driver</label>
            <select id="preview-driver" disabled={loadingDrivers} value={selectedId} onChange={(event) => { const id = event.target.value; setSelectedId(id); setSelectedDriver(null); setTasks([]); setInstructions([]); if (id) void loadPreview(id); }} className="mt-1 w-full rounded-xl border border-cyan-300 bg-white px-3 py-3">
              <option value="">Select Driver</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.displayName}</option>)}
            </select>
            <div className="mt-3 flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.12em]">Read-only preview</p>{selectedDriver ? <div className="flex gap-2"><button type="button" onClick={() => { void loadPreview(selectedId); }} className="inline-flex items-center gap-1 rounded-lg border border-cyan-400 bg-white px-3 py-2 text-xs font-bold uppercase"><RefreshCw className="h-4 w-4" /> Refresh</button><button type="button" onClick={() => { setSelectedId(""); setSelectedDriver(null); setTasks([]); setInstructions([]); }} className="rounded-lg bg-cyan-900 px-3 py-2 text-xs font-bold uppercase text-white">Exit Preview</button></div> : null}</div>
          </section>

          {error ? <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">{error}</div> : null}
          {loadingPreview ? <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">Loading Driver preview...</div> : null}
          {selectedDriver && !loadingPreview ? <><section className="grid grid-cols-3 gap-2">{[["To Do", grouped.todo.length], ["In Progress", grouped.progress.length], ["Completed", grouped.completed.length]].map(([label, count]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-bold uppercase text-slate-500">{label}</p><p className="text-xl font-bold">{count}</p></div>)}</section><section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-sm font-bold uppercase tracking-[0.16em]">Operational Instructions</h2><p className="mt-2 text-sm">{instructions.length} recent · {instructions.filter((item) => !item.readAt).length} unread</p></section>{renderTasks("Needs Attention", grouped.attention)}{renderTasks("To Do", grouped.todo)}{renderTasks("In Progress", grouped.progress)}{renderTasks("Completed Today", grouped.completed)}</> : null}

          {selectedDriver && (overlayInstruction || overlayTask) ? <div role="dialog" aria-modal="true" aria-label="Operational alert overlay" className={`fixed inset-0 z-[95] flex items-center justify-center px-4 ${overlayCritical ? "bg-rose-950/80" : "bg-slate-950/75"}`}><section className={`w-full max-w-lg rounded-3xl border-2 p-5 ${overlayCritical ? "border-rose-400 bg-rose-100 text-rose-950" : "border-amber-400 bg-amber-50 text-amber-950"}`}><p className="text-xs font-black uppercase tracking-[0.18em]">{overlayCritical ? "Critical" : "Attention"}</p><h2 className="mt-2 text-2xl font-black">{overlayInstruction ? "New Instruction" : "New Assignment"}</h2>{overlayInstruction ? <p className="mt-3 font-bold">{overlayInstruction.instruction}</p> : null}{overlayTask ? <p className="mt-2">Trailer: {overlayTask.trailerNumber}</p> : null}<p className="mt-5 w-full rounded-xl bg-slate-200 px-4 py-3 text-center text-sm font-black">READ-ONLY PREVIEW</p><button type="button" onClick={() => setDismissedAlertKeys((current) => [...current, overlayInstruction ? `instruction:${overlayInstruction.id}` : `task:${overlayTask?.bookingId}`])} className="mt-2 w-full rounded-xl bg-slate-950 px-4 py-3 font-black text-white">Close Preview Alert</button></section></div> : null}
        </div>
      </main>
    </PermissionGuard>
  );
}
