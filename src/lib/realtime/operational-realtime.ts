"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type PublicTableName = keyof Database["public"]["Tables"];

export type RealtimeTopic =
  | "dashboard"
  | "compound"
  | "timeline"
  | "ai"
  | "activity"
  | "notifications";

const topicTableMap: Record<RealtimeTopic, PublicTableName[]> = {
  dashboard: [
    "trailers",
    "delivery_bookings",
    "export_allocations",
    "trailer_events",
    "trailer_audit_log",
    "trailer_activity_log",
    "operational_alerts",
    "operational_alert_settings",
    "vessel_operations",
    "vessel_operation_trailers",
    "compound_stock_checks",
    "compound_stock_check_items",
  ],
  compound: ["trailers", "delivery_bookings", "export_allocations"],
  timeline: ["trailer_audit_log", "trailer_activity_log"],
  ai: [
    "trailers",
    "delivery_bookings",
    "export_allocations",
    "trailer_audit_log",
    "trailer_activity_log",
    "operational_alerts",
    "vessel_operations",
    "vessel_operation_trailers",
    "compound_stock_checks",
    "compound_stock_check_items",
  ],
  activity: ["trailer_activity_log", "trailer_audit_log", "trailer_events"],
  notifications: [
    "trailer_activity_log",
    "trailer_audit_log",
    "trailer_events",
    "operational_alerts",
    "delivery_bookings",
    "export_allocations",
    "vessel_operation_trailers",
    "compound_stock_check_items",
  ],
};

type Listener = {
  id: number;
  topics: Set<RealtimeTopic>;
  onSignal: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
};

let channel: RealtimeChannel | null = null;
let activeChannelTables = new Set<PublicTableName>();
let listenerIdCounter = 1;
const listeners = new Map<number, Listener>();

const getTablesForTopics = (topics: RealtimeTopic[]) => {
  const tables = new Set<PublicTableName>();
  for (const topic of topics) {
    for (const tableName of topicTableMap[topic]) {
      tables.add(tableName);
    }
  }
  return tables;
};

const setEquals = <T,>(left: Set<T>, right: Set<T>) => {
  if (left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
};

const getTablesForActiveListeners = () => {
  const tables = new Set<PublicTableName>();
  listeners.forEach((listener) => {
    Array.from(listener.topics).forEach((topic) => {
      topicTableMap[topic].forEach((tableName) => {
        tables.add(tableName);
      });
    });
  });

  return tables;
};

const buildChannel = (tables: Set<PublicTableName>) => {
  if (tables.size === 0) {
    return null;
  }

  const nextChannel = supabase.channel("trailerhub-operational-realtime");

  for (const tableName of tables) {
    nextChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: tableName },
      (payload) => {
        const sourceTable = payload.table as PublicTableName;

        listeners.forEach((listener) => {
          const shouldNotify = Array.from(listener.topics).some((topic) => topicTableMap[topic].includes(sourceTable));
          if (shouldNotify) {
            listener.onSignal(payload as RealtimePostgresChangesPayload<Record<string, unknown>>);
          }
        });
      },
    );
  }

  nextChannel.subscribe();
  return nextChannel;
};

const syncChannelToListeners = () => {
  const requiredTables = getTablesForActiveListeners();

  if (requiredTables.size === 0) {
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
      activeChannelTables = new Set<PublicTableName>();
    }
    return;
  }

  if (channel && setEquals(requiredTables, activeChannelTables)) {
    return;
  }

  if (channel) {
    void supabase.removeChannel(channel);
  }

  channel = buildChannel(requiredTables);
  activeChannelTables = requiredTables;
};

type SubscribeOptions = {
  topics: RealtimeTopic[];
  onSignal: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
};

const subscribeOperationalRealtime = ({ topics, onSignal }: SubscribeOptions) => {
  const id = listenerIdCounter;
  listenerIdCounter += 1;

  listeners.set(id, {
    id,
    topics: new Set(topics),
    onSignal,
  });

  syncChannelToListeners();

  return () => {
    listeners.delete(id);
    syncChannelToListeners();
  };
};

type UseOperationalRealtimeOptions = {
  enabled?: boolean;
  debounceMs?: number;
};

export const useOperationalRealtime = (
  topics: RealtimeTopic[],
  onSignal: () => void,
  options?: UseOperationalRealtimeOptions,
) => {
  const callbackRef = useRef(onSignal);
  const enabled = options?.enabled ?? true;
  const debounceMs = options?.debounceMs ?? 450;
  const topicKey = [...topics].sort().join("|");

  useEffect(() => {
    callbackRef.current = onSignal;
  }, [onSignal]);

  useEffect(() => {
    const normalizedTopics = topicKey.length > 0 ? (topicKey.split("|") as RealtimeTopic[]) : [];

    if (!enabled || normalizedTopics.length === 0) {
      return;
    }

    let timeout: number | null = null;

    const unsubscribe = subscribeOperationalRealtime({
      topics: normalizedTopics,
      onSignal: () => {
        if (timeout !== null) {
          window.clearTimeout(timeout);
        }

        timeout = window.setTimeout(() => {
          callbackRef.current();
        }, debounceMs);
      },
    });

    return () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      unsubscribe();
    };
  }, [enabled, debounceMs, topicKey]);
};
