"use client";

import { useEffect, useMemo, useState } from "react";
import { PermissionGuard } from "@/components/auth/permission-guard";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSessionToken } from "@/lib/voice/session";
import {
  ACTIVE_TRANSPORT_JOB_STATUSES,
  FLEET_UNIT_TYPES,
  formatFleetDateTime,
  jobStatusLabel,
  nextJobStatus,
  normalizeFleetSearch,
  unitTypeLabel,
} from "@/lib/fleet-transport";

type Unit = { id: string; registration: string; internal_number: string; unit_type: string; active: boolean; notes: string | null };
type Driver = { id: string; display_name: string; active: boolean };
type Trailer = { id: string; trailer_number: string | null };
type Job = {
  id: string;
  job_reference: string;
  status: string;
  driver_id: string | null;
  unit_id: string | null;
  trailer_id: string | null;
  trailer_number_snapshot: string | null;
  customer: string | null;
  booking_reference: string | null;
  collection_address: string | null;
  delivery_address: string | null;
  collection_at: string | null;
  delivery_at: string | null;
  notes: string | null;
  created_at: string;
};
type JobEvent = { id: string; event_type: string; event_title: string; event_description: string | null; metadata: Record<string, unknown>; created_by_user_id: string | null; created_at: string; previous_driver_id: string | null; new_driver_id: string | null; previous_unit_id: string | null; new_unit_id: string | null; previous_trailer_id: string | null; new_trailer_id: string | null; previous_status: string | null; new_status: string | null };
type FleetPayload = { units: Unit[]; jobs: Job[]; drivers: Driver[]; trailers: Trailer[] };
type Tab = "drivers" | "units" | "jobs";

const emptyPayload: FleetPayload = { units: [], jobs: [], drivers: [], trailers: [] };
const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100";
const statusClass: Record<string, string> = { planned: "bg-slate-100 text-slate-700", assigned: "bg-cyan-100 text-cyan-800", in_progress: "bg-amber-100 text-amber-800", completed: "bg-emerald-100 text-emerald-800", cancelled: "bg-rose-100 text-rose-800" };
const activeJob = (job: Job) => ACTIVE_TRANSPORT_JOB_STATUSES.includes(job.status as (typeof ACTIVE_TRANSPORT_JOB_STATUSES)[number]);
const formDateToIso = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return text ? new Date(text).toISOString() : null;
};

export default function FleetPage() {
  const { roleKey } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("jobs");
  const [data, setData] = useState<FleetPayload>(emptyPayload);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [showJobForm, setShowJobForm] = useState(false);
  const [unitSearch, setUnitSearch] = useState("");
  const [unitStatus, setUnitStatus] = useState("active");
  const [unitType, setUnitType] = useState("all");
  const [jobSearch, setJobSearch] = useState("");
  const [jobStatus, setJobStatus] = useState("active");
  const [jobDriver, setJobDriver] = useState("all");
  const [jobUnit, setJobUnit] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<JobEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const canEdit = roleKey === "administrator" || roleKey === "supervisor";

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const token = await getSessionToken();
      const response = await fetch("/api/fleet", { headers: { Authorization: `Bearer ${token}` } });
      const payload = (await response.json()) as FleetPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load Fleet / Transport.");
      setData(payload);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load Fleet / Transport."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const driverById = useMemo(() => new Map(data.drivers.map((driver) => [driver.id, driver])), [data.drivers]);
  const unitById = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit])), [data.units]);
  const trailerById = useMemo(() => new Map(data.trailers.map((trailer) => [trailer.id, trailer])), [data.trailers]);
  const activeAssignments = useMemo(() => {
    const drivers = new Map<string, Job>(); const units = new Map<string, Job>();
    data.jobs.filter(activeJob).forEach((job) => { if (job.driver_id) drivers.set(job.driver_id, job); if (job.unit_id) units.set(job.unit_id, job); });
    return { drivers, units };
  }, [data.jobs]);
  const filteredUnits = useMemo(() => {
    const term = normalizeFleetSearch(unitSearch);
    return data.units.filter((unit) => (!term || `${unit.registration} ${unit.internal_number} ${unit.unit_type}`.toLowerCase().includes(term)) && (unitStatus === "all" || (unitStatus === "active" ? unit.active : !unit.active)) && (unitType === "all" || unit.unit_type === unitType));
  }, [data.units, unitSearch, unitStatus, unitType]);
  const filteredJobs = useMemo(() => {
    const term = normalizeFleetSearch(jobSearch);
    return data.jobs.filter((job) => {
      const driver = job.driver_id ? driverById.get(job.driver_id)?.display_name : "";
      const unit = job.unit_id ? unitById.get(job.unit_id) : null;
      const trailer = job.trailer_id ? trailerById.get(job.trailer_id)?.trailer_number : job.trailer_number_snapshot;
      const haystack = `${job.job_reference} ${job.customer ?? ""} ${job.booking_reference ?? ""} ${job.collection_address ?? ""} ${job.delivery_address ?? ""} ${driver ?? ""} ${unit?.registration ?? ""} ${unit?.internal_number ?? ""} ${trailer ?? ""}`.toLowerCase();
      return (!term || haystack.includes(term)) && (jobStatus === "active" ? activeJob(job) : jobStatus === "all" || job.status === jobStatus) && (jobDriver === "all" || job.driver_id === jobDriver) && (jobUnit === "all" || job.unit_id === jobUnit);
    });
  }, [data.jobs, driverById, jobDriver, jobSearch, jobStatus, jobUnit, trailerById, unitById]);

  const save = async (event: React.FormEvent<HTMLFormElement>, entity: "unit" | "job", id?: string) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const body = entity === "unit"
      ? { entity, ...(id ? { id } : {}), registration: String(form.get("registration")), internalNumber: String(form.get("internalNumber")), unitType: String(form.get("unitType")), notes: String(form.get("notes") ?? ""), active: form.get("active") === "on" }
      : { entity, ...(id ? { id } : {}), jobReference: String(form.get("jobReference")), status: String(form.get("status")), driverId: String(form.get("driverId")) || null, unitId: String(form.get("unitId")) || null, trailerId: String(form.get("trailerId")) || null, trailerNumberSnapshot: String(form.get("trailerId") ? trailerById.get(String(form.get("trailerId")))?.trailer_number ?? "" : "") || null, customer: String(form.get("customer")) || null, bookingReference: String(form.get("bookingReference")) || null, collectionAddress: String(form.get("collectionAddress")) || null, deliveryAddress: String(form.get("deliveryAddress")) || null, collectionAt: formDateToIso(form.get("collectionAt")), deliveryAt: formDateToIso(form.get("deliveryAt")), notes: String(form.get("notes")) || null };
    try {
      const token = await getSessionToken(); const response = await fetch("/api/fleet", { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const payload = (await response.json()) as { error?: string; warning?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to save Fleet record.");
      setError(null); setMessage(payload.warning ?? (entity === "unit" ? "Unit saved." : "Transport job saved.")); setShowUnitForm(false); setShowJobForm(false); setEditingUnit(null); setEditingJob(null); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Unable to save Fleet record."); }
  };
  const quickStatus = async (job: Job, status: string) => {
    const request = { entity: "job", id: job.id, jobReference: job.job_reference, status, driverId: job.driver_id, unitId: job.unit_id, trailerId: job.trailer_id, trailerNumberSnapshot: job.trailer_number_snapshot, customer: job.customer, bookingReference: job.booking_reference, collectionAddress: job.collection_address, deliveryAddress: job.delivery_address, collectionAt: job.collection_at, deliveryAt: job.delivery_at, notes: job.notes };
    try { const token = await getSessionToken(); const response = await fetch("/api/fleet", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(request) }); const payload = (await response.json()) as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to update job status."); setMessage(status === "cancelled" ? "Transport job cancelled." : `Job moved to ${jobStatusLabel(status)}.`); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Unable to update job status."); }
  };
  const loadHistory = async (job: Job) => {
    setHistoryJob(job); setHistoryLoading(true); setError(null);
    try {
      const token = await getSessionToken(); const response = await fetch(`/api/fleet?jobId=${encodeURIComponent(job.id)}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = (await response.json()) as { events?: JobEvent[]; error?: string }; if (!response.ok) throw new Error(payload.error ?? "Unable to load Job history."); setHistory(payload.events ?? []);
    } catch (historyError) { setError(historyError instanceof Error ? historyError.message : "Unable to load Job history."); setHistory([]); }
    finally { setHistoryLoading(false); }
  };

  const unitForm = (unit: Unit | null) => <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event, "unit", unit?.id)}>
    <label className="text-sm font-medium">Registration<input name="registration" defaultValue={unit?.registration ?? ""} required className={inputClass} /></label>
    <label className="text-sm font-medium">Internal number<input name="internalNumber" defaultValue={unit?.internal_number ?? ""} required className={inputClass} /></label>
    <label className="text-sm font-medium">Transport type<select name="unitType" defaultValue={unit?.unit_type ?? "tractor_only"} className={inputClass}>{FLEET_UNIT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="flex items-center gap-2 pt-7 text-sm font-medium"><input name="active" type="checkbox" defaultChecked={unit?.active ?? true} /> Active unit</label>
    <label className="text-sm font-medium sm:col-span-2">Notes<textarea name="notes" defaultValue={unit?.notes ?? ""} className={inputClass} rows={2} /></label>
    <div className="flex gap-2 sm:col-span-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save Unit</button><button type="button" onClick={() => { setShowUnitForm(false); setEditingUnit(null); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button></div>
  </form>;
  const jobForm = (job: Job | null) => <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event, "job", job?.id)}>
    <label className="text-sm font-medium">Job reference<input name="jobReference" defaultValue={job?.job_reference ?? ""} required className={inputClass} /></label>
    <label className="text-sm font-medium">Status<select name="status" defaultValue={job?.status ?? "planned"} className={inputClass}>{["planned", "assigned", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{jobStatusLabel(value)}</option>)}</select></label>
    <label className="text-sm font-medium">Driver<select name="driverId" defaultValue={job?.driver_id ?? ""} className={inputClass}><option value="">Unassigned</option>{data.drivers.filter((driver) => driver.active || driver.id === job?.driver_id).map((driver) => <option key={driver.id} value={driver.id}>{driver.display_name}{activeAssignments.drivers.has(driver.id) && activeAssignments.drivers.get(driver.id)?.id !== job?.id ? " - active job" : ""}</option>)}</select></label>
    <label className="text-sm font-medium">Unit<select name="unitId" defaultValue={job?.unit_id ?? ""} className={inputClass}><option value="">Unassigned</option>{data.units.filter((unit) => unit.active || unit.id === job?.unit_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.registration} / {unit.internal_number}{activeAssignments.units.has(unit.id) && activeAssignments.units.get(unit.id)?.id !== job?.id ? " - active job" : ""}</option>)}</select></label>
    <label className="text-sm font-medium">Trailer<select name="trailerId" defaultValue={job?.trailer_id ?? ""} className={inputClass}><option value="">No trailer</option>{data.trailers.map((trailer) => <option key={trailer.id} value={trailer.id}>{trailer.trailer_number ?? trailer.id}</option>)}</select></label>
    <label className="text-sm font-medium">Customer<input name="customer" defaultValue={job?.customer ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium">Booking / reference<input name="bookingReference" defaultValue={job?.booking_reference ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium">Collection / origin<input name="collectionAddress" defaultValue={job?.collection_address ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium">Delivery / destination<input name="deliveryAddress" defaultValue={job?.delivery_address ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium">Planned collection<input name="collectionAt" type="datetime-local" defaultValue={job?.collection_at?.slice(0, 16) ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium">Planned delivery<input name="deliveryAt" type="datetime-local" defaultValue={job?.delivery_at?.slice(0, 16) ?? ""} className={inputClass} /></label>
    <label className="text-sm font-medium sm:col-span-2">Notes<textarea name="notes" defaultValue={job?.notes ?? ""} className={inputClass} rows={2} /></label>
    <div className="flex gap-2 sm:col-span-2"><button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save Job</button><button type="button" onClick={() => { setShowJobForm(false); setEditingJob(null); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Close</button></div>
  </form>;

  return <PermissionGuard roleKey={roleKey} moduleKey="fleet_transport" action="view" allowWhenRoleMissing={false}><main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6"><div className="mx-auto max-w-[1500px] space-y-5"><header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-700">Transport operations</p><h1 className="mt-2 text-3xl font-semibold">Fleet / Transport</h1><p className="mt-2 text-sm text-slate-600">Drivers, units, and transport jobs stay separate so assignments can change without losing job identity.</p></header>{error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}{message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}<nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">{(["drivers", "units", "jobs"] as Tab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item === "jobs" ? "Transport Jobs" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>{loading ? <div className="rounded-2xl bg-white p-6 text-sm text-slate-600">Loading Fleet / Transport...</div> : null}{!loading && tab === "drivers" ? <DriversSection drivers={data.drivers} assignments={activeAssignments.drivers} units={unitById} /> : null}{!loading && tab === "units" ? <UnitsSection canEdit={canEdit} units={filteredUnits} activeAssignments={activeAssignments.units} drivers={driverById} form={showUnitForm ? unitForm(editingUnit) : null} onAdd={() => { setEditingUnit(null); setShowUnitForm(true); }} onEdit={(unit) => { setEditingUnit(unit); setShowUnitForm(true); }} unitSearch={unitSearch} setUnitSearch={setUnitSearch} unitStatus={unitStatus} setUnitStatus={setUnitStatus} unitType={unitType} setUnitType={setUnitType} /> : null}{!loading && tab === "jobs" ? <JobsSection canEdit={canEdit} jobs={filteredJobs} drivers={driverById} units={unitById} trailers={trailerById} form={showJobForm ? jobForm(editingJob) : null} onAdd={() => { setEditingJob(null); setShowJobForm(true); }} onEdit={(job) => { setEditingJob(job); setShowJobForm(true); }} onStatus={quickStatus} onHistory={loadHistory} jobSearch={jobSearch} setJobSearch={setJobSearch} jobStatus={jobStatus} setJobStatus={setJobStatus} jobDriver={jobDriver} setJobDriver={setJobDriver} jobUnit={jobUnit} setJobUnit={setJobUnit} allDrivers={data.drivers} allUnits={data.units} /> : null}{historyJob ? <HistoryPanel job={historyJob} events={history} loading={historyLoading} drivers={driverById} units={unitById} trailers={trailerById} onClose={() => setHistoryJob(null)} /> : null}</div></main></PermissionGuard>;
}

function DriversSection({ drivers, assignments, units }: { drivers: Driver[]; assignments: Map<string, Job>; units: Map<string, Unit> }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Drivers</h2><p className="mt-1 text-sm text-slate-600">Authoritative Drivers reused from the existing Drivers entity.</p></div><span className="text-sm text-slate-500">{drivers.length} records</span></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Driver</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Current Unit</th><th className="px-3 py-3">Current Job</th></tr></thead><tbody>{drivers.map((driver) => { const job = assignments.get(driver.id); const unit = job?.unit_id ? units.get(job.unit_id) : null; return <tr key={driver.id} className="border-b last:border-0"><td className="px-3 py-3 font-semibold">{driver.display_name}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${driver.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{driver.active ? "Active" : "Inactive"}</span></td><td className="px-3 py-3">{unit ? `${unit.registration} / ${unit.internal_number}` : "-"}</td><td className="px-3 py-3">{job?.job_reference ?? "-"}</td></tr>; })}</tbody></table></div></section>;
}

function UnitsSection({ canEdit, units, activeAssignments, drivers, form, onAdd, onEdit, unitSearch, setUnitSearch, unitStatus, setUnitStatus, unitType, setUnitType }: { canEdit: boolean; units: Unit[]; activeAssignments: Map<string, Job>; drivers: Map<string, Driver>; form: React.ReactNode; onAdd: () => void; onEdit: (unit: Unit) => void; unitSearch: string; setUnitSearch: (value: string) => void; unitStatus: string; setUnitStatus: (value: string) => void; unitType: string; setUnitType: (value: string) => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Units / Trucks</h2><p className="mt-1 text-sm text-slate-600">Deactivate units instead of deleting fleet history.</p></div>{canEdit ? <button type="button" onClick={onAdd} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Add Unit</button> : null}</div>{form ? <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4">{form}</div> : null}<div className="mt-4 grid gap-3 md:grid-cols-3"><input aria-label="Search units" value={unitSearch} onChange={(event) => setUnitSearch(event.target.value)} placeholder="Search registration or internal number" className={inputClass} /><select aria-label="Unit status" value={unitStatus} onChange={(event) => setUnitStatus(event.target.value)} className={inputClass}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All status</option></select><select aria-label="Transport type" value={unitType} onChange={(event) => setUnitType(event.target.value)} className={inputClass}><option value="all">All transport types</option>{FLEET_UNIT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Registration</th><th className="px-3 py-3">Internal</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Current driver</th><th className="px-3 py-3">Current job</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{units.map((unit) => { const job = activeAssignments.get(unit.id); const driver = job?.driver_id ? drivers.get(job.driver_id) : null; return <tr key={unit.id} className="border-b last:border-0"><td className="px-3 py-3 font-semibold">{unit.registration}</td><td className="px-3 py-3">{unit.internal_number}</td><td className="px-3 py-3">{unitTypeLabel(unit.unit_type)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${unit.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{unit.active ? "Active" : "Inactive"}</span></td><td className="px-3 py-3">{driver?.display_name ?? "-"}</td><td className="px-3 py-3">{job?.job_reference ?? "-"}</td><td className="px-3 py-3">{canEdit ? <button type="button" onClick={() => onEdit(unit)} className="font-semibold text-cyan-700 hover:underline">Edit</button> : <span className="text-slate-400">View only</span>}</td></tr>; })}</tbody></table></div></section>;
}

function JobsSection({ canEdit, jobs, drivers, units, trailers, form, onAdd, onEdit, onStatus, onHistory, jobSearch, setJobSearch, jobStatus, setJobStatus, jobDriver, setJobDriver, jobUnit, setJobUnit, allDrivers, allUnits }: { canEdit: boolean; jobs: Job[]; drivers: Map<string, Driver>; units: Map<string, Unit>; trailers: Map<string, Trailer>; form: React.ReactNode; onAdd: () => void; onEdit: (job: Job) => void; onStatus: (job: Job, status: string) => Promise<void>; onHistory: (job: Job) => Promise<void>; jobSearch: string; setJobSearch: (value: string) => void; jobStatus: string; setJobStatus: (value: string) => void; jobDriver: string; setJobDriver: (value: string) => void; jobUnit: string; setJobUnit: (value: string) => void; allDrivers: Driver[]; allUnits: Unit[] }) {
   return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Transport Jobs</h2><p className="mt-1 text-sm text-slate-600">Reassign Driver, Unit, or Trailer on the same Job ID.</p></div>{canEdit ? <button type="button" onClick={onAdd} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">New Job</button> : null}</div>{form ? <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-4">{form}</div> : null}<div className="mt-4 grid gap-3 md:grid-cols-4"><input aria-label="Search jobs" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search job, customer, route, trailer" className={`${inputClass} md:col-span-2`} /><select aria-label="Job status" value={jobStatus} onChange={(event) => setJobStatus(event.target.value)} className={inputClass}><option value="active">Active jobs</option><option value="all">All statuses</option>{["planned", "assigned", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{jobStatusLabel(value)}</option>)}</select><select aria-label="Job driver" value={jobDriver} onChange={(event) => setJobDriver(event.target.value)} className={inputClass}><option value="all">All drivers</option>{allDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.display_name}</option>)}</select><select aria-label="Job unit" value={jobUnit} onChange={(event) => setJobUnit(event.target.value)} className={inputClass}><option value="all">All units</option>{allUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.registration}</option>)}</select></div><div className="mt-4 overflow-x-auto"><table className="min-w-[1150px] text-left text-sm"><thead><tr className="border-b text-xs uppercase tracking-wider text-slate-500"><th className="px-3 py-3">Job</th><th className="px-3 py-3">Driver</th><th className="px-3 py-3">Unit</th><th className="px-3 py-3">Trailer</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Route</th><th className="px-3 py-3">Planned</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{jobs.map((job) => { const driver = job.driver_id ? drivers.get(job.driver_id) : null; const unit = job.unit_id ? units.get(job.unit_id) : null; const trailer = job.trailer_id ? trailers.get(job.trailer_id)?.trailer_number : job.trailer_number_snapshot; const next = nextJobStatus(job.status); return <tr key={job.id} className="border-b align-top last:border-0"><td className="px-3 py-3 font-semibold">{job.job_reference}<div className="mt-1 text-xs text-slate-500">{job.booking_reference ?? "No booking reference"}</div></td><td className="px-3 py-3">{driver?.display_name ?? "Unassigned"}</td><td className="px-3 py-3">{unit ? `${unit.registration} / ${unit.internal_number}` : "Unassigned"}</td><td className="px-3 py-3">{trailer ?? "-"}</td><td className="px-3 py-3">{job.customer ?? "-"}</td><td className="max-w-[240px] px-3 py-3">{job.collection_address ?? "-"}<span className="block text-slate-400">to {job.delivery_address ?? "-"}</span></td><td className="px-3 py-3">{formatFleetDateTime(job.collection_at)}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass[job.status] ?? "bg-slate-100 text-slate-700"}`}>{jobStatusLabel(job.status)}</span></td><td className="px-3 py-3"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void onHistory(job)} className="font-semibold text-cyan-700 hover:underline">History</button>{canEdit ? <button type="button" onClick={() => onEdit(job)} className="font-semibold text-cyan-700 hover:underline">Edit / Assign</button> : null}{canEdit && next ? <button type="button" onClick={() => void onStatus(job, next)} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white">{next === "in_progress" ? "Start" : "Complete"}</button> : null}{canEdit && activeJob(job) ? <button type="button" onClick={() => { if (window.confirm("Cancel this transport job?")) void onStatus(job, "cancelled"); }} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700">Cancel</button> : null}</div></td></tr>; })}</tbody></table></div></section>;
}

  function HistoryPanel({ job, events, loading, drivers, units, trailers, onClose }: { job: Job; events: JobEvent[]; loading: boolean; drivers: Map<string, Driver>; units: Map<string, Unit>; trailers: Map<string, Trailer>; onClose: () => void }) {
    const label = (id: string | null, kind: "driver" | "unit" | "trailer") => id ? (kind === "driver" ? drivers.get(id)?.display_name : kind === "unit" ? units.get(id)?.registration : trailers.get(id)?.trailer_number) ?? "Historical entity unavailable" : "Unassigned";
    return <section aria-label="Job history" className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">History: {job.job_reference}</h2><p className="text-sm text-slate-600">Immutable Fleet events, newest first.</p></div><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold">Close</button></div>{loading ? <p className="mt-4 text-sm text-slate-600">Loading Job history...</p> : events.length === 0 ? <p className="mt-4 text-sm text-slate-600">No history recorded.</p> : <ol className="mt-4 space-y-3">{events.map((event) => <li key={event.id} className="border-l-2 border-cyan-200 pl-3"><p className="text-xs text-slate-500">{formatFleetDateTime(event.created_at)}</p><p className="font-semibold">{event.event_title}</p><p className="text-sm text-slate-700">{event.event_description ?? ""}</p>{event.previous_driver_id !== null || event.new_driver_id !== null ? <p className="text-sm">{label(event.previous_driver_id, "driver")} -&gt; {label(event.new_driver_id, "driver")}</p> : null}{event.previous_unit_id !== null || event.new_unit_id !== null ? <p className="text-sm">{label(event.previous_unit_id, "unit")} -&gt; {label(event.new_unit_id, "unit")}</p> : null}{event.previous_trailer_id !== null || event.new_trailer_id !== null ? <p className="text-sm">{label(event.previous_trailer_id, "trailer")} -&gt; {label(event.new_trailer_id, "trailer")}</p> : null}</li>)}</ol>}</section>;
  }
