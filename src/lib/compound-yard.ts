import type { Database } from "@/lib/database.types";
import { syncTrailerCurrentOperationalState } from "@/lib/operations/trailer-current-state";

export const COMPOUND_CAPACITY = 50;

export const compoundLocationSignalTypes = ["qr", "nfc", "rfid", "ble", "indoor_positioning"] as const;

export type CompoundLocationSignalType = (typeof compoundLocationSignalTypes)[number];

export type CompoundLocationSignal = {
  type: CompoundLocationSignalType;
  label: string;
  enabled: boolean;
  details?: string | null;
  lastSeenAt?: string | null;
};

export type CompoundMovementRecord = {
  trailerId?: string | null;
  trailerNumber?: string | null;
  previousCompoundPosition?: string | null;
  newCompoundPosition?: string | null;
  createdAt?: string | null;
  eventType: string;
};

export type CompoundPositionSnapshot = {
  position: string;
  trailerId: string | null;
  trailerNumber: string | null;
  customer: string | null;
  loadStatus: string | null;
  operationalStatus: string | null;
  compoundPosition: string | null;
  priorityLevel: string | null;
  vesselName: string | null;
  exportStatus: string | null;
  updatedAt: string | null;
  isOccupied: boolean;
};

export type CompoundHeatmapRow = {
  position: string;
  movementCount: number;
  averageDwellHours: number;
  currentOccupancy: number;
  lastMovementAt: string | null;
};

type CompoundMoveRpcClient = {
  rpc: unknown;
  from?: unknown;
};

export const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return trimmed;
  }

  const numericValue = Number(match[2]);
  if (!Number.isFinite(numericValue) || numericValue < 1 || numericValue > COMPOUND_CAPACITY) {
    return null;
  }

  return `P${numericValue.toString().padStart(2, "0")}`;
};

export const compareCompoundPosition = (left: string, right: string) => {
  const leftNormalized = normalizeCompoundPosition(left) ?? left;
  const rightNormalized = normalizeCompoundPosition(right) ?? right;
  return leftNormalized.localeCompare(rightNormalized, undefined, { numeric: true, sensitivity: "base" });
};

export async function moveCompoundTrailer(
  rpcClient: CompoundMoveRpcClient,
  input: {
    trailerId: string;
    targetPosition: string;
    movedBy?: string | null;
    reason?: string | null;
  },
) {
  const normalizedPosition = normalizeCompoundPosition(input.targetPosition);
  if (!normalizedPosition) {
    throw new Error("Enter a valid compound position.");
  }

  const rpc = rpcClient.rpc as (fn: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;

  const { data, error } = await rpc("move_compound_trailer", {
    p_trailer_id: input.trailerId,
    p_target_position: normalizedPosition,
    p_moved_by: input.movedBy ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) {
    throw new Error(error.message || "Unable to move trailer in compound.");
  }

  const moved = data as Database["public"]["Tables"]["trailers"]["Row"] | null;
  if (moved?.id && typeof (rpcClient as { from?: unknown }).from === "function") {
    const synchronized = await syncTrailerCurrentOperationalState(rpcClient as never, moved.id, {
      intent: "place_on_compound",
    });
    return (synchronized as Database["public"]["Tables"]["trailers"]["Row"] | null) ?? moved;
  }

  return moved;
}

const getPositionBucket = () => ({
  movementCount: 0,
  dwellTotalMs: 0,
  dwellSamples: 0,
  currentOccupancy: 0,
  lastMovementAt: null as string | null,
  activeEntries: new Map<string, string>(),
});

export function buildCompoundHeatmap(
  positions: CompoundPositionSnapshot[],
  movements: CompoundMovementRecord[],
): CompoundHeatmapRow[] {
  const buckets = new Map<string, ReturnType<typeof getPositionBucket>>();
  const ensureBucket = (position: string) => {
    const normalized = normalizeCompoundPosition(position) ?? position;
    const bucket = buckets.get(normalized);
    if (bucket) {
      return bucket;
    }

    const next = getPositionBucket();
    buckets.set(normalized, next);
    return next;
  };

  positions.forEach((position) => {
    const bucket = ensureBucket(position.position);
    bucket.currentOccupancy = position.isOccupied ? 1 : 0;
    if (position.updatedAt) {
      bucket.lastMovementAt = position.updatedAt;
    }
  });

  const groupedByTrailer = new Map<string, CompoundMovementRecord[]>();
  movements.forEach((movement) => {
    const trailerKey = movement.trailerId ?? movement.trailerNumber ?? null;
    if (!trailerKey) {
      return;
    }

    const current = groupedByTrailer.get(trailerKey) ?? [];
    current.push(movement);
    groupedByTrailer.set(trailerKey, current);
  });

  const nowMs = Date.now();

  groupedByTrailer.forEach((records) => {
    const sorted = [...records].sort((left, right) => new Date(left.createdAt ?? 0).getTime() - new Date(right.createdAt ?? 0).getTime());
    let activePosition: string | null = null;
    let activeStartMs: number | null = null;

    sorted.forEach((record) => {
      const createdAtMs = new Date(record.createdAt ?? 0).getTime();
      const previousPosition = normalizeCompoundPosition(record.previousCompoundPosition);
      const nextPosition = normalizeCompoundPosition(record.newCompoundPosition);

      if (previousPosition) {
        const bucket = ensureBucket(previousPosition);
        bucket.movementCount += 1;
        bucket.lastMovementAt = record.createdAt ?? bucket.lastMovementAt;
      }

      if (nextPosition) {
        const bucket = ensureBucket(nextPosition);
        bucket.movementCount += 1;
        bucket.lastMovementAt = record.createdAt ?? bucket.lastMovementAt;
      }

      if (activePosition && activeStartMs !== null) {
        const previousBucket = ensureBucket(activePosition);
        const dwellMs = Math.max(0, createdAtMs - activeStartMs);
        previousBucket.dwellTotalMs += dwellMs;
        previousBucket.dwellSamples += 1;
      }

      if (nextPosition) {
        activePosition = nextPosition;
        activeStartMs = createdAtMs;
      } else if (previousPosition) {
        activePosition = null;
        activeStartMs = null;
      }
    });

    if (activePosition && activeStartMs !== null) {
      const activeBucket = ensureBucket(activePosition);
      activeBucket.dwellTotalMs += Math.max(0, nowMs - activeStartMs);
      activeBucket.dwellSamples += 1;
    }
  });

  return Array.from(buckets.entries())
    .map(([position, bucket]) => ({
      position,
      movementCount: bucket.movementCount,
      averageDwellHours: bucket.dwellSamples > 0 ? bucket.dwellTotalMs / bucket.dwellSamples / 3_600_000 : 0,
      currentOccupancy: bucket.currentOccupancy,
      lastMovementAt: bucket.lastMovementAt,
    }))
    .sort((left, right) => right.movementCount - left.movementCount || compareCompoundPosition(left.position, right.position));
}
