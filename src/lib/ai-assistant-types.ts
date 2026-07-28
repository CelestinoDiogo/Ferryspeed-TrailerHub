import { z } from "zod";

export const aiAssistantIntentNames = [
  "find_trailer",
  "trailer_current_status",
  "trailer_location",
  "list_expected_trailers",
  "list_arrived_trailers",
  "list_pending_inspections",
  "list_inspections_in_progress",
  "list_completed_inspections",
  "list_priority_trailers",
  "list_temperature_alerts",
  "list_missing_photos",
  "compound_summary",
  "compound_empty_trailers",
  "compound_loaded_trailers",
  "compound_available_trailers",
  "compound_long_dwell",
  "compound_free_positions",
  "export_allocated",
  "export_waiting_loading",
  "export_waiting_collection",
  "export_overdue",
  "departures_today",
  "departures_by_customer",
  "unresolved_operational_alerts",
  "stock_check_discrepancies",
  "current_operational_summary",
  "latest_inspection",
  "trailer_history",
  "list_waiting_compound",
  "count_empty",
  "list_empty",
  "count_loaded",
  "list_loaded",
  "count_compound",
  "list_compound",
  "count_arrivals_today",
  "arrivals_today",
  "count_departures_today",
  "operations_summary_today",
  "vessel_operations_today",
  "export_by_status",
  "trailers_with_damage",
  "trailers_with_temperature_alert",
  "trailers_by_customer",
  "unknown",
] as const;

export const aiAssistantIntentNameSchema = z.enum(aiAssistantIntentNames);

// Legacy export set kept for compatibility with older assistant modules.
export const allowedExportStatuses = [
  "allocated",
  "delivered_empty",
  "waiting_loading",
  "collected_loaded",
  "completed",
  "cancelled",
] as const;

const baseIntentSchema = z
  .object({
    intent: aiAssistantIntentNameSchema,
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["today", "all", "latest"]).optional(),
    priorityOnly: z.boolean().optional(),
    trailerNumber: z.string().trim().min(2).max(24).optional(),
    customer: z.string().trim().min(2).max(80).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(allowedExportStatuses).optional(),
    minHours: z.number().int().min(1).max(24 * 30).optional(),
    vesselOperationId: z.string().uuid().optional(),
  })
  .strict();

const trailerIntentSchema = z
  .object({
    intent: z.enum(["find_trailer", "trailer_current_status", "trailer_location"]),
    trailerNumber: z.string().trim().min(2).max(24),
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["today", "all", "latest"]).optional(),
    priorityOnly: z.boolean().optional(),
  })
  .strict();

const customerIntentSchema = z
  .object({
    intent: z.enum(["departures_by_customer"]),
    customer: z.string().trim().min(2).max(80),
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["today", "all", "latest"]).optional(),
    priorityOnly: z.boolean().optional(),
  })
  .strict();

const dwellIntentSchema = z
  .object({
    intent: z.literal("compound_long_dwell"),
    minHours: z.number().int().min(1).max(24 * 30).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["today", "all", "latest"]).optional(),
    priorityOnly: z.boolean().optional(),
  })
  .strict();

const vesselScopeIntentSchema = z
  .object({
    intent: z.enum([
      "list_expected_trailers",
      "list_arrived_trailers",
      "list_pending_inspections",
      "list_inspections_in_progress",
      "list_completed_inspections",
      "list_priority_trailers",
      "list_missing_photos",
    ]),
    vesselOperationId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    scope: z.enum(["today", "all", "latest"]).optional(),
    priorityOnly: z.boolean().optional(),
  })
  .strict();

const genericIntentSchema = z.discriminatedUnion("intent", [
  trailerIntentSchema,
  customerIntentSchema,
  dwellIntentSchema,
  vesselScopeIntentSchema,
  baseIntentSchema.extend({ intent: z.literal("list_temperature_alerts") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("compound_summary") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("compound_empty_trailers") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("compound_loaded_trailers") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("compound_available_trailers") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("compound_free_positions") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("export_allocated") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("export_waiting_loading") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("export_waiting_collection") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("export_overdue") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("departures_today") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("unresolved_operational_alerts") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("stock_check_discrepancies") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("current_operational_summary") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("latest_inspection"), trailerNumber: z.string().trim().min(2).max(24) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("trailer_history"), trailerNumber: z.string().trim().min(2).max(24) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("list_waiting_compound") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("count_empty") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("list_empty") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("count_loaded") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("list_loaded"), customer: z.string().trim().min(2).max(80).optional() }).strict(),
  baseIntentSchema.extend({ intent: z.literal("count_compound") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("list_compound") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("count_arrivals_today"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("arrivals_today"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("count_departures_today"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("operations_summary_today"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("vessel_operations_today"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("export_by_status"), status: z.enum(allowedExportStatuses) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("trailers_with_damage") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("trailers_with_temperature_alert") }).strict(),
  baseIntentSchema.extend({ intent: z.literal("trailers_by_customer"), customer: z.string().trim().min(2).max(80) }).strict(),
  baseIntentSchema.extend({ intent: z.literal("unknown") }).strict(),
]);

export const aiAssistantIntentSchema = genericIntentSchema;

export type AiAssistantIntent = z.infer<typeof aiAssistantIntentSchema>;
export type AiAssistantIntentName = AiAssistantIntent["intent"];

export type AiAssistantLink = {
  label: string;
  href: string;
};

export type AiAssistantSummaryItem = {
  label: string;
  value: string | number;
};

export type AiAssistantSectionItem = {
  label: string;
  value: string | number;
};

export type AiAssistantSection = {
  key: string;
  title: string;
  items: AiAssistantSectionItem[];
};

export type AiAssistantAlert = {
  severity: "neutral" | "warning" | "critical" | "success";
  message: string;
};

export type AiAssistantRecord = Record<string, unknown>;

export type AiAssistantUiResultType = "text" | "trailer" | "trailer_list" | "summary";

export const aiAssistantContextSchema = z
  .object({
    pathname: z.string().trim().max(200).optional(),
    activeVesselOperationId: z.string().uuid().optional(),
    selectedCompoundFilter: z.string().trim().max(64).optional(),
    openedTrailerId: z.string().uuid().optional(),
    openedTrailerNumber: z.string().trim().max(32).optional(),
    currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export type AiAssistantContext = z.infer<typeof aiAssistantContextSchema>;

export type AiAssistantItem = {
  trailerId?: string;
  trailerNumber: string;
  status?: string;
  customer?: string;
  compoundPosition?: string;
  detail?: string;
  route?: string;
};

export type AiAssistantAction = {
  label: string;
  route: string;
  filter?: Record<string, string | number | boolean>;
};

export type AiAssistantPreparedAction = {
  id: string;
  label: string;
  requiresConfirmation: boolean;
  confirmationPrompt: string;
  moduleLabel: string;
  moduleHref: string;
  safetyLevel: "high" | "medium";
};

export type AiAssistantResponse = {
  intent: AiAssistantIntentName;
  title: string;
  summary: string;
  count?: number;
  items?: AiAssistantItem[];
  actions?: AiAssistantAction[];
  sourceModules: string[];
  queriedAt: string;
  // Legacy compatibility fields consumed by voice/mobile helpers.
  answer: string;
  resultType: AiAssistantUiResultType;
  data: Array<Record<string, unknown>>;
  links: AiAssistantLink[];
  primaryMetrics?: AiAssistantSummaryItem[];
  sections?: AiAssistantSection[];
  alerts?: AiAssistantAlert[];
  preparedActions?: AiAssistantPreparedAction[];
  truncated?: boolean;
};
