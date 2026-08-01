"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  Clock3,
  FileText,
  Package,
  Search,
  Shield,
  Ship,
  SquareStack,
  Thermometer,
  Truck,
  UserRound,
  Waves,
} from "lucide-react";
import { searchGlobal } from "@/lib/search/global-search-client";
import type { GlobalSearchCategory, GlobalSearchResponse, GlobalSearchResultItem } from "@/lib/search/global-search";

type GlobalSearchProps = {
  mode?: "desktop" | "mobile";
  className?: string;
  enableKeyboardShortcut?: boolean;
};

type SearchHistoryEntry = {
  query: string;
  at: string;
};

const RECENT_SEARCHES_KEY = "trailerhub.global-search.recent.v1";
const SEARCH_HISTORY_KEY = "trailerhub.global-search.history.v1";
const RECENT_SEARCHES_LIMIT = 10;
const SEARCH_HISTORY_LIMIT = 120;
const SEARCH_DEBOUNCE_MS = 260;
const GLOBAL_SEARCH_OPEN_EVENT = "trailerhub:global-search-open";

const CATEGORY_ICON: Record<GlobalSearchCategory, ComponentType<{ className?: string }>> = {
  trailers: Truck,
  export_operations: SquareStack,
  vessel_operations: Ship,
  arrival_records: Waves,
  inspection_records: Shield,
  damage_reports: AlertTriangle,
  temperature_records: Thermometer,
  photos: Camera,
  users: UserRound,
  reports: FileText,
  compound_positions: Package,
};

const STATUS_BADGE_STYLES: Array<{ test: (value: string) => boolean; className: string }> = [
  {
    test: (value) => /active|ready|normal|arrived|inspected|available|completed/.test(value),
    className: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    test: (value) => /pending|waiting|draft/.test(value),
    className: "border border-amber-200 bg-amber-50 text-amber-700",
  },
  {
    test: (value) => /out_of_range|alert|inactive|cancelled|critical/.test(value),
    className: "border border-rose-200 bg-rose-50 text-rose-700",
  },
];

const normalizeStatusText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

const formatStatusLabel = (value: string) => {
  const cleaned = value.trim();
  if (!cleaned) {
    return "Unknown";
  }

  return cleaned
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const readLocalEntries = (storageKey: string): SearchHistoryEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is SearchHistoryEntry => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const candidate = entry as Partial<SearchHistoryEntry>;
        return typeof candidate.query === "string" && typeof candidate.at === "string";
      })
      .map((entry) => ({ query: entry.query.trim(), at: entry.at }))
      .filter((entry) => entry.query.length > 0);
  } catch {
    return [];
  }
};

const writeLocalEntries = (storageKey: string, entries: SearchHistoryEntry[]) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Ignore quota/security errors to keep search usable.
  }
};

const mergeSearchEntry = (entries: SearchHistoryEntry[], query: string, limit: number): SearchHistoryEntry[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return entries;
  }

  const next: SearchHistoryEntry[] = [
    { query: query.trim(), at: new Date().toISOString() },
    ...entries.filter((entry) => entry.query.trim().toLowerCase() !== normalized),
  ];

  return next.slice(0, limit);
};

const getStatusBadgeClassName = (status: string) => {
  const normalized = normalizeStatusText(status);
  const rule = STATUS_BADGE_STYLES.find((candidate) => candidate.test(normalized));
  return rule?.className ?? "border border-slate-200 bg-slate-100 text-slate-700";
};

const isKeyboardScopeMatch = (mode: "desktop" | "mobile") => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return mode === "desktop"
    ? window.matchMedia("(min-width: 1024px)").matches
    : window.matchMedia("(max-width: 1023px)").matches;
};

export function GlobalSearch({ mode = "desktop", className, enableKeyboardShortcut = true }: GlobalSearchProps) {
  const instanceId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const navigateTo = useCallback((href: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.location.assign(href);
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<GlobalSearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>(() => readLocalEntries(RECENT_SEARCHES_KEY));
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(() => readLocalEntries(SEARCH_HISTORY_KEY));

  const openSearch = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: { instanceId } }));
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    setIsOpen(true);
    setError(null);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [instanceId]);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(0);
    setError(null);

    const restoreTarget = restoreFocusRef.current;
    if (restoreTarget) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }, []);

  useEffect(() => {
    const onGlobalOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ instanceId?: string }>;
      const incomingId = customEvent.detail?.instanceId;
      if (incomingId && incomingId !== instanceId) {
        setIsOpen(false);
      }
    };

    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, onGlobalOpen);
    return () => window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, onGlobalOpen);
  }, [instanceId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!enableKeyboardShortcut) {
      return;
    }

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (!isKeyboardScopeMatch(mode)) {
        return;
      }

      const hasCommand = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      if (hasCommand) {
        event.preventDefault();
        if (!isOpen) {
          openSearch();
        }
        return;
      }

      if (!isOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [closeSearch, enableKeyboardShortcut, isOpen, mode, openSearch]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!debouncedQuery) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await searchGlobal({
          query: debouncedQuery,
          limit: 20,
          offset: 0,
        });

        if (!cancelled) {
          setResponse(payload);
          setActiveIndex(0);
        }
      } catch (searchError) {
        if (!cancelled) {
          setResponse(null);
          setError(searchError instanceof Error ? searchError.message : "Unable to search right now.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen]);

  const flatResults = useMemo(() => response?.results ?? [], [response]);

  useEffect(() => {
    if (!isOpen || flatResults.length === 0) {
      return;
    }

    const container = listRef.current;
    const item = container?.querySelector<HTMLButtonElement>(`[data-search-index='${activeIndex}']`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatResults.length, isOpen]);

  const persistQuery = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setRecentSearches((current) => {
      const merged = mergeSearchEntry(current, trimmed, RECENT_SEARCHES_LIMIT);
      writeLocalEntries(RECENT_SEARCHES_KEY, merged);
      return merged;
    });

    setSearchHistory((current) => {
      const merged = mergeSearchEntry(current, trimmed, SEARCH_HISTORY_LIMIT);
      writeLocalEntries(SEARCH_HISTORY_KEY, merged);
      return merged;
    });
  }, []);

  const openResult = useCallback((item: GlobalSearchResultItem) => {
    persistQuery(query || item.title);
    closeSearch();
    navigateTo(item.href);
  }, [closeSearch, navigateTo, persistQuery, query]);

  const onInputKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (flatResults.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flatResults.length);
      return;
    }

    if (event.key === "ArrowUp") {
      if (flatResults.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + flatResults.length) % flatResults.length);
      return;
    }

    if (event.key === "Enter") {
      if (flatResults.length === 0) {
        persistQuery(query);
        return;
      }

      event.preventDefault();
      const selected = flatResults[Math.max(0, Math.min(activeIndex, flatResults.length - 1))];
      if (selected) {
        openResult(selected);
      }
    }
  }, [activeIndex, flatResults, openResult, persistQuery, query]);

  const triggerClassName = mode === "mobile"
    ? "inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
    : "inline-flex min-h-11 w-[280px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-slate-700 shadow-sm transition hover:bg-slate-50";

  return (
    <>
      <button type="button" onClick={openSearch} className={[triggerClassName, className].filter(Boolean).join(" ")} aria-label="Open global search">
        <span className="inline-flex items-center gap-2">
          <Search className="h-4 w-4" />
          {mode === "desktop" ? <span className="text-sm font-medium">Search trailers, exports, vessels...</span> : null}
        </span>
        {mode === "desktop" ? <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">Ctrl K</span> : null}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[90] overflow-x-hidden bg-slate-950/35 px-3 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Global search">
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.25)]">
            <div className="border-b border-slate-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Search trailers, bookings, vessels, inspections, users, reports..."
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  aria-label="Search"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"
                >
                  ESC
                </button>
              </div>
            </div>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {!debouncedQuery ? (
                <div className="space-y-5">
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent searches</p>
                    {recentSearches.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No recent searches yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {recentSearches.map((entry) => (
                          <button
                            key={`recent-${entry.query}`}
                            type="button"
                            onClick={() => setQuery(entry.query)}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                          >
                            {entry.query}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Search history</p>
                    {searchHistory.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">Search history is empty.</p>
                    ) : (
                      <ul className="space-y-2">
                        {searchHistory.slice(0, 10).map((entry) => (
                          <li key={`history-${entry.query}-${entry.at}`}>
                            <button
                              type="button"
                              onClick={() => setQuery(entry.query)}
                              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                            >
                              <span className="text-sm text-slate-800">{entry.query}</span>
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                <Clock3 className="h-3.5 w-3.5" />
                                {new Date(entry.at).toLocaleString("en-GB", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              ) : null}

              {debouncedQuery ? (
                <>
                  {isLoading ? <p className="text-sm text-slate-500">Searching...</p> : null}
                  {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
                  {!isLoading && !error && response?.results.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No results found.</p>
                  ) : null}

                  {!isLoading && !error && response?.groups.length ? (
                    <div className="space-y-5">
                      {response.groups.map((group) => (
                        <section key={group.category}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label} ({group.count})</p>
                          <div className="space-y-2">
                            {group.items.map((item) => {
                              const resultIndex = flatResults.findIndex((candidate) => candidate.id === item.id);
                              const selected = resultIndex === activeIndex;
                              const Icon = CATEGORY_ICON[item.category];

                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  data-search-index={resultIndex}
                                  onMouseEnter={() => setActiveIndex(resultIndex)}
                                  onClick={() => openResult(item)}
                                  className={[
                                    "flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition",
                                    selected ? "border-cyan-300 bg-cyan-50/80" : "border-slate-200 hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600">
                                    <Icon className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
                                    <span className="block truncate text-xs text-slate-500">{item.subtitle || "No additional details"}</span>
                                  </span>
                                  <span className="inline-flex items-center gap-2">
                                    <span className={["rounded-full px-2 py-1 text-[11px] font-medium", getStatusBadgeClassName(item.status)].join(" ")}>{formatStatusLabel(item.status)}</span>
                                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600" title={item.quickActionLabel}>
                                      <ArrowUpRight className="h-4 w-4" />
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
