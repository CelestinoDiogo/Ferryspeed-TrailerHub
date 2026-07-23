"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export type OnlineUser = {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
};

type PresenceUser = {
  userId?: string;
  name?: string;
  role?: string;
  joinedAt?: string;
};

const mapPresenceState = (presenceState: Record<string, PresenceUser[]>) => {
  const users = new Map<string, OnlineUser>();

  Object.values(presenceState).forEach((entries) => {
    entries.forEach((entry) => {
      const userId = entry.userId?.trim();
      if (!userId) {
        return;
      }

      users.set(userId, {
        userId,
        name: entry.name?.trim() || "User",
        role: entry.role?.trim() || "role",
        joinedAt: entry.joinedAt?.trim() || new Date().toISOString(),
      });
    });
  });

  return Array.from(users.values()).sort((left, right) => left.name.localeCompare(right.name));
};

export const useOnlineUsers = (userId: string | null, name: string, role: string) => {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const identity = useMemo(
    () => ({
      userId,
      name,
      role,
      joinedAt: new Date().toISOString(),
    }),
    [userId, name, role],
  );

  useEffect(() => {
    if (!identity.userId) {
      setOnlineUsers([]);
      setIsConnected(false);
      return;
    }

    const channel = supabase.channel("trailerhub-online-users", {
      config: {
        presence: {
          key: identity.userId,
        },
      },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        setOnlineUsers(mapPresenceState(state));
      })
      .on("presence", { event: "join" }, () => {
        const state = channel.presenceState<PresenceUser>();
        setOnlineUsers(mapPresenceState(state));
      })
      .on("presence", { event: "leave" }, () => {
        const state = channel.presenceState<PresenceUser>();
        setOnlineUsers(mapPresenceState(state));
      })
      .subscribe(async (status) => {
        setIsConnected(status === "SUBSCRIBED");

        if (status === "SUBSCRIBED") {
          await channel.track({
            userId: identity.userId,
            name: identity.name,
            role: identity.role,
            joinedAt: identity.joinedAt,
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      setIsConnected(false);
    };
  }, [identity]);

  return { onlineUsers, isConnected };
};
