import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { createAuthenticatedRouteSupabaseClient, getRouteBearerToken, requireAuthenticatedRouteUser, SupabaseRouteAuthError } from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const unitSchema = z.object({
  registration: z.string().trim().min(1).max(32),
  internalNumber: z.string().trim().min(1).max(32),
  unitType: z.enum(["tractor_only", "curtain_sider", "reefer", "flatbed", "rigid", "other"]),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
}).strict();

const parseUnitPayload = (body: unknown) => unitSchema.parse({
  registration: (body as Record<string, unknown>).registration,
  internalNumber: (body as Record<string, unknown>).internalNumber,
  unitType: (body as Record<string, unknown>).unitType,
  notes: (body as Record<string, unknown>).notes,
  active: (body as Record<string, unknown>).active,
});

const jobSchema = z.object({
  jobReference: z.string().trim().min(1).max(64),
  status: z.enum(["planned", "assigned", "in_progress", "completed", "cancelled"]).optional(),
  driverId: z.string().uuid().nullable().optional(),
  unitId: z.string().uuid().nullable().optional(),
  trailerId: z.string().uuid().nullable().optional(),
  trailerNumberSnapshot: z.string().trim().max(32).nullable().optional(),
  customer: z.string().trim().max(160).nullable().optional(),
  bookingReference: z.string().trim().max(80).nullable().optional(),
  collectionAddress: z.string().trim().max(300).nullable().optional(),
  deliveryAddress: z.string().trim().max(300).nullable().optional(),
  collectionAt: z.string().datetime().nullable().optional(),
  deliveryAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).strict();

const requireFleet = async (request: Request, action: "view" | "create" | "edit") => {
  const accessToken = getRouteBearerToken(request);
  const supabase = createAuthenticatedRouteSupabaseClient(request);
  const user = await requireAuthenticatedRouteUser(supabase, accessToken);
  await bootstrapCurrentUserRole(supabase, user);
  await requireRbacPermission(supabase, user.id, "fleet_transport", action);
  return { supabase, user };
};

const activeJobStatuses = ["planned", "assigned", "in_progress"];

const findAssignmentWarnings = async (supabase: ReturnType<typeof createAuthenticatedRouteSupabaseClient>, driverId: string | null, unitId: string | null, excludedJobId?: string) => {
  const { data, error } = await supabase
    .from("transport_jobs")
    .select("id,job_reference,driver_id,unit_id,status")
    .in("status", activeJobStatuses)
    .or(`driver_id.eq.${driverId ?? "00000000-0000-0000-0000-000000000000"},unit_id.eq.${unitId ?? "00000000-0000-0000-0000-000000000000"}`);

  if (error) {
    throw error;
  }

  const conflicts = (data ?? []).filter((job) => job.id !== excludedJobId && ((driverId && job.driver_id === driverId) || (unitId && job.unit_id === unitId)));
  return conflicts.map((job) => {
    const resources = [driverId && job.driver_id === driverId ? "driver" : null, unitId && job.unit_id === unitId ? "unit" : null].filter(Boolean).join(" and ");
    return `${resources} already assigned to active job ${job.job_reference}`;
  });
};

export async function GET(request: Request) {
  try {
    const { supabase } = await requireFleet(request, "view");
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (jobId) {
      const { data, error } = await supabase.from("transport_job_events").select("id,transport_job_id,event_type,event_title,event_description,previous_driver_id,new_driver_id,previous_unit_id,new_unit_id,previous_trailer_id,new_trailer_id,previous_status,new_status,metadata,created_by_user_id,created_at").eq("transport_job_id", jobId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return Response.json({ events: data ?? [] });
    }
    const [units, jobs, drivers, trailers] = await Promise.all([
      supabase.from("fleet_transport_units").select("id,registration,internal_number,unit_type,active,notes,created_at,updated_at").order("registration", { ascending: true }),
      supabase.from("transport_jobs").select("id,job_reference,status,driver_id,unit_id,trailer_id,trailer_number_snapshot,customer,booking_reference,collection_address,delivery_address,collection_at,delivery_at,notes,created_at,updated_at,completed_at,cancelled_at").order("created_at", { ascending: false }),
      supabase.from("drivers").select("id,display_name,active,user_id").order("display_name", { ascending: true }),
      supabase.from("trailers").select("id,trailer_number").order("trailer_number", { ascending: true }).limit(500),
    ]);
    const error = units.error ?? jobs.error ?? drivers.error ?? trailers.error;
    if (error) throw error;
    return Response.json({ units: units.data ?? [], jobs: jobs.data ?? [], drivers: drivers.data ?? [], trailers: trailers.data ?? [] });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError || error instanceof RbacPermissionError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load Fleet / Transport data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireFleet(request, "create");
    const body = await request.json().catch(() => ({}));
    const entity = z.enum(["unit", "job"]).parse(body.entity);
    if (entity === "unit") {
      const payload = parseUnitPayload(body);
      const { data, error } = await supabase.from("fleet_transport_units").insert({ registration: payload.registration, internal_number: payload.internalNumber, unit_type: payload.unitType, notes: payload.notes ?? null, active: payload.active ?? true }).select().single();
      if (error) throw error;
      return Response.json({ unit: data }, { status: 201 });
    }
    const payload = jobSchema.parse(body);
    const status = payload.status ?? (payload.driverId || payload.unitId ? "assigned" : "planned");
    const warnings = await findAssignmentWarnings(supabase, payload.driverId ?? null, payload.unitId ?? null);
    const { data, error } = await supabase.rpc("create_transport_job_with_event", { p_payload: { job_reference: payload.jobReference, status, driver_id: payload.driverId ?? null, unit_id: payload.unitId ?? null, trailer_id: payload.trailerId ?? null, trailer_number_snapshot: payload.trailerNumberSnapshot ?? null, customer: payload.customer ?? null, booking_reference: payload.bookingReference ?? null, collection_address: payload.collectionAddress ?? null, delivery_address: payload.deliveryAddress ?? null, collection_at: payload.collectionAt ?? null, delivery_at: payload.deliveryAt ?? null, notes: payload.notes ?? null }, actor_id: user.id });
    if (error) throw error;
    return Response.json({ job: data, ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}) }, { status: 201 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError || error instanceof RbacPermissionError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid Fleet / Transport payload." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create Fleet / Transport record." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await requireFleet(request, "edit");
    const body = await request.json().catch(() => ({}));
    const entity = z.enum(["unit", "job"]).parse(body.entity);
    const id = z.string().uuid().parse(body.id);
    if (entity === "unit") {
      const payload = parseUnitPayload(body);
      const { data, error } = await supabase.from("fleet_transport_units").update({ registration: payload.registration, internal_number: payload.internalNumber, unit_type: payload.unitType, notes: payload.notes ?? null, active: payload.active ?? true }).eq("id", id).select().single();
      if (error) throw error;
      return Response.json({ unit: data });
    }
    const payload = jobSchema.parse(body);
    const warnings = await findAssignmentWarnings(supabase, payload.driverId ?? null, payload.unitId ?? null, id);
    const { data, error } = await supabase.rpc("update_transport_job_with_event", { p_job_id: id, p_payload: { job_reference: payload.jobReference, status: payload.status, driver_id: payload.driverId ?? null, unit_id: payload.unitId ?? null, trailer_id: payload.trailerId ?? null, trailer_number_snapshot: payload.trailerNumberSnapshot ?? null, customer: payload.customer ?? null, booking_reference: payload.bookingReference ?? null, collection_address: payload.collectionAddress ?? null, delivery_address: payload.deliveryAddress ?? null, collection_at: payload.collectionAt ?? null, delivery_at: payload.deliveryAt ?? null, notes: payload.notes ?? null }, actor_id: user.id });
    if (error) throw error;
    return Response.json({ job: data, ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}) });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError || error instanceof RbacPermissionError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: "Invalid Fleet / Transport payload." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update Fleet / Transport record." }, { status: 400 });
  }
}
