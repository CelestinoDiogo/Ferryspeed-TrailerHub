import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/049_fleet_transport_rpc_execute_hardening.sql"), "utf8").replace(/\r\n/g, "\n");

describe("Fleet Transport RPC execute hardening migration 049", () => {
  it("revokes public and anonymous execution from public Fleet RPCs", () => {
    expect(sql).toContain("revoke execute\non function public.create_transport_job_with_event(jsonb, uuid)\nfrom public;");
    expect(sql).toContain("revoke execute\non function public.create_transport_job_with_event(jsonb, uuid)\nfrom anon;");
    expect(sql).toContain("revoke execute\non function public.update_transport_job_with_event(uuid, jsonb, uuid)\nfrom public;");
    expect(sql).toContain("revoke execute\non function public.update_transport_job_with_event(uuid, jsonb, uuid)\nfrom anon;");
  });

  it("retains authenticated and service role execution only for create/update", () => {
    expect(sql).toContain("grant execute\non function public.create_transport_job_with_event(jsonb, uuid)\nto authenticated;");
    expect(sql).toContain("grant execute\non function public.create_transport_job_with_event(jsonb, uuid)\nto service_role;");
    expect(sql).toContain("grant execute\non function public.update_transport_job_with_event(uuid, jsonb, uuid)\nto authenticated;");
    expect(sql).toContain("grant execute\non function public.update_transport_job_with_event(uuid, jsonb, uuid)\nto service_role;");
    expect(sql).toContain("revoke execute\non function public.require_fleet_transport_actor(uuid)\nfrom authenticated;");
    expect(sql).toContain("revoke execute\non function public.prevent_transport_job_event_mutation()\nfrom authenticated;");
  });

  it("contains no data, schema, policy, RLS, or realtime mutation", () => {
    expect(sql).not.toMatch(/drop\s+(table|function|policy)|delete\s+from|truncate\s+(table\s+)?public\./i);
    expect(sql).not.toMatch(/alter\s+table|create\s+(table|policy|trigger)|enable\s+row\s+level\s+security|publication|realtime/i);
    expect(sql).not.toContain("transport_job_events");
    expect(sql).not.toContain("transport_jobs");
  });
});
