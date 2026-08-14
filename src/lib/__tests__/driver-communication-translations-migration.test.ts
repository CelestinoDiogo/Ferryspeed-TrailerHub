import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "supabase/migrations/045_driver_communication_translations.sql");
const migration = readFileSync(migrationPath, "utf8");

const canonicalInstructionTable = "driver_operational_instructions";
const canonicalEventTable = "driver_operational_instruction_events";

describe("migration 045 Driver Communications translation storage", () => {
  it("creates dedicated instruction and event translation tables", () => {
    expect(migration).toContain("create table if not exists public.driver_operational_instruction_translations");
    expect(migration).toContain("create table if not exists public.driver_operational_instruction_event_translations");
    expect(migration).toContain("instruction_id uuid not null references public.driver_operational_instructions(id)");
    expect(migration).toContain("event_id uuid not null references public.driver_operational_instruction_events(id)");
  });

  it("constrains supported languages, statuses, hashes, and cache uniqueness", () => {
    expect(migration).toMatch(/target_language in \('en', 'pt', 'lv', 'ru'\)/g);
    expect(migration).toContain("source_text_hash text not null");
    expect(migration).toContain("unique (instruction_id, target_language, source_text_hash)");
    expect(migration).toContain("unique (event_id, target_language, source_text_hash)");
    expect(migration).toContain("translation_status in ('translated', 'failed')");
  });

  it("does not alter canonical communication text or operational data", () => {
    expect(migration).not.toMatch(/alter table public\.driver_operational_instructions/);
    expect(migration).not.toMatch(/alter table public\.driver_operational_instruction_events/);
    expect(migration).not.toMatch(new RegExp(`delete\\s+from\\s+public\\.${canonicalInstructionTable}`));
    expect(migration).not.toMatch(new RegExp(`delete\\s+from\\s+public\\.${canonicalEventTable}`));
    expect(migration).not.toMatch(new RegExp(`truncate\\s+(table\\s+)?public\\.${canonicalInstructionTable}`));
    expect(migration).not.toMatch(new RegExp(`truncate\\s+(table\\s+)?public\\.${canonicalEventTable}`));
    expect(migration).toContain("translated_text text null");
  });

  it("restricts reads by parent ownership and avoids authenticated cache writes", () => {
    expect(migration).toContain("Drivers can read own instruction translations");
    expect(migration).toContain("Drivers can read own instruction event translations");
    expect(migration).toContain("owned_driver.user_id = auth.uid()");
    expect(migration).toContain("owned_driver.active = true");
    expect(migration).toContain("revoke insert, update, delete, truncate, references, trigger");
    expect(migration).toContain("grant select on table public.driver_operational_instruction_translations to authenticated");
    expect(migration).toContain("grant select on table public.driver_operational_instruction_event_translations to authenticated");
    expect(migration).toContain("grant all privileges on table public.driver_operational_instruction_translations to service_role");
    expect(migration).toContain("grant all privileges on table public.driver_operational_instruction_event_translations to service_role");
  });

  it("keeps the existing migrations untouched and enables realtime for derived cache rows", () => {
    expect(migration).not.toContain("042_driver_operational_instruction_events");
    expect(migration).not.toContain("044_driver_operational_instruction_events_security_repair");
    expect(migration).toContain("alter publication supabase_realtime add table public.driver_operational_instruction_translations");
    expect(migration).toContain("alter publication supabase_realtime add table public.driver_operational_instruction_event_translations");
  });
});
