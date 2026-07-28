import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  buildOperationalEventIdempotencyKey,
  recordOperationalEvent,
  type OperationalSourceModule,
} from "@/lib/operations/operational-events";
import { getInvalidTransitionReason, type OperationalStage } from "@/lib/operations/operational-stages";
import { createTrailerActivity } from "@/lib/trailer-activity";

export type TrailerLifecycleEventInput = {
  trailerId?: string | null;
  trailerNumber: string;
  eventType: string;
  title: string;
  description: string;
  sourceModule: OperationalSourceModule | "operations";
  sourceRecordId?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousCompoundPosition?: string | null;
  newCompoundPosition?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
  performedBy?: string | null;
  oldValue?: Json | null;
  newValue?: Json | null;
  idempotencyKey?: string | null;
  skipOperationalEvent?: boolean;
};

const normalizeText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeOperationalSourceModule = (
  sourceModule: TrailerLifecycleEventInput["sourceModule"],
): OperationalSourceModule => {
  if (sourceModule === "operations") {
    return "system";
  }

  return sourceModule;
};

export const assertOperationalStageTransition = (
  fromStage: OperationalStage,
  toStage: OperationalStage,
) => {
  const reason = getInvalidTransitionReason(fromStage, toStage);
  if (reason) {
    throw new Error(reason);
  }
};

export const recordTrailerLifecycleEvent = async (
  supabaseClient: SupabaseClient<Database>,
  input: TrailerLifecycleEventInput,
) => {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const normalizedSourceModule = normalizeOperationalSourceModule(input.sourceModule);
  const idempotencyKey = normalizeText(input.idempotencyKey) ?? buildOperationalEventIdempotencyKey({
    trailerId: input.trailerId,
    trailerNumber: input.trailerNumber,
    eventType: input.eventType,
    sourceModule: normalizedSourceModule,
    sourceRecordId: input.sourceRecordId,
    occurredAt,
  });

  if (!input.skipOperationalEvent) {
    await recordOperationalEvent(supabaseClient, {
      trailerId: input.trailerId,
      trailerNumber: input.trailerNumber,
      eventType: input.eventType,
      title: input.title,
      description: input.description,
      occurredAt,
      userName: input.performedBy ?? null,
      sourceModule: normalizedSourceModule,
      sourceRecordId: input.sourceRecordId ?? null,
      metadata: {
        ...(input.metadata ?? {}),
      },
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      idempotencyKey,
      requireSuccess: true,
    });
  }

  await createTrailerActivity({
    supabaseClient,
    trailerId: input.trailerId,
    trailerNumber: input.trailerNumber,
    eventType: input.eventType,
    eventTitle: input.title,
    eventDescription: input.description,
    sourceModule: input.sourceModule,
    sourceRecordId: input.sourceRecordId ?? null,
    previousStatus: input.previousStatus ?? null,
    newStatus: input.newStatus ?? null,
    previousCompoundPosition: input.previousCompoundPosition ?? null,
    newCompoundPosition: input.newCompoundPosition ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      idempotency_key: idempotencyKey,
    },
    performedBy: input.performedBy ?? null,
    createdAt: occurredAt,
    idempotencyKey,
  });

  return {
    occurredAt,
    idempotencyKey,
  };
};
