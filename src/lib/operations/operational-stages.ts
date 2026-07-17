export type OperationalStage =
  | "expected"
  | "arrived"
  | "inspection"
  | "received"
  | "not_discharged"
  | "compound"
  | "local"
  | "hold"
  | "allocated"
  | "delivered_empty"
  | "waiting_loading"
  | "collected_loaded"
  | "ready_for_shipping"
  | "loaded_on_vessel"
  | "on_delivery"
  | "delivered"
  | "waiting_collection"
  | "maintenance"
  | "departed"
  | "cancelled";

export type OperationalStageCategory =
  | "informational"
  | "processing"
  | "yard"
  | "customer"
  | "shipping"
  | "issue"
  | "historical";

export type OperationalStageConfig = {
  id: OperationalStage;
  label: string;
  description: string;
  badgeClassName: string;
  category: OperationalStageCategory;
  terminal: boolean;
  sortOrder: number;
};

export const OPERATIONAL_STAGE_CONFIG: Record<OperationalStage, OperationalStageConfig> = {
  expected: {
    id: "expected",
    label: "Expected",
    description: "Trailer is planned on an active vessel list and not yet discharged.",
    badgeClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    category: "informational",
    terminal: false,
    sortOrder: 10,
  },
  arrived: {
    id: "arrived",
    label: "Arrived",
    description: "Trailer has been discharged and is awaiting or entering inspection.",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    category: "processing",
    terminal: false,
    sortOrder: 20,
  },
  inspection: {
    id: "inspection",
    label: "Inspection",
    description: "Boat Check or inspection is in progress or pending completion.",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    category: "processing",
    terminal: false,
    sortOrder: 30,
  },
  received: {
    id: "received",
    label: "Received",
    description: "Trailer has been received into the active trailer register.",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    category: "processing",
    terminal: false,
    sortOrder: 40,
  },
  not_discharged: {
    id: "not_discharged",
    label: "Not Discharged",
    description: "Trailer remained on the vessel or was not discharged into the active yard workflow.",
    badgeClassName: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200",
    category: "issue",
    terminal: false,
    sortOrder: 45,
  },
  compound: {
    id: "compound",
    label: "In Compound",
    description: "Trailer is active in the yard with a compound position.",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    category: "yard",
    terminal: false,
    sortOrder: 50,
  },
  local: {
    id: "local",
    label: "Local Trailer",
    description: "Trailer is active but marked as local rather than yard-positioned.",
    badgeClassName: "border-slate-500/30 bg-slate-500/10 text-slate-200",
    category: "yard",
    terminal: false,
    sortOrder: 60,
  },
  hold: {
    id: "hold",
    label: "Awaiting Position",
    description: "Trailer has been received but is on hold pending a valid position or next action.",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    category: "issue",
    terminal: false,
    sortOrder: 70,
  },
  allocated: {
    id: "allocated",
    label: "Allocated",
    description: "Trailer is allocated to an export operation.",
    badgeClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    category: "shipping",
    terminal: false,
    sortOrder: 80,
  },
  delivered_empty: {
    id: "delivered_empty",
    label: "Delivered Empty",
    description: "Empty trailer has been delivered to the customer for loading.",
    badgeClassName: "border-indigo-500/30 bg-indigo-500/10 text-indigo-200",
    category: "customer",
    terminal: false,
    sortOrder: 90,
  },
  waiting_loading: {
    id: "waiting_loading",
    label: "Waiting Loading",
    description: "Trailer is at customer site and waiting to be loaded.",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    category: "customer",
    terminal: false,
    sortOrder: 100,
  },
  collected_loaded: {
    id: "collected_loaded",
    label: "Collected Loaded",
    description: "Loaded trailer has been collected from the customer site.",
    badgeClassName: "border-orange-500/30 bg-orange-500/10 text-orange-200",
    category: "shipping",
    terminal: false,
    sortOrder: 110,
  },
  ready_for_shipping: {
    id: "ready_for_shipping",
    label: "Ready for Shipping",
    description: "Loaded trailer is under Ferryspeed control and ready for vessel assignment.",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    category: "shipping",
    terminal: false,
    sortOrder: 115,
  },
  loaded_on_vessel: {
    id: "loaded_on_vessel",
    label: "Loaded on Vessel",
    description: "Trailer is physically loaded to a vessel and awaiting departure completion.",
    badgeClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    category: "shipping",
    terminal: false,
    sortOrder: 117,
  },
  on_delivery: {
    id: "on_delivery",
    label: "On Delivery",
    description: "Trailer is in transit to a delivery destination.",
    badgeClassName: "border-violet-500/30 bg-violet-500/10 text-violet-200",
    category: "customer",
    terminal: false,
    sortOrder: 120,
  },
  delivered: {
    id: "delivered",
    label: "Delivered",
    description: "Trailer has been delivered and may require later collection.",
    badgeClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    category: "customer",
    terminal: false,
    sortOrder: 130,
  },
  waiting_collection: {
    id: "waiting_collection",
    label: "Waiting Collection",
    description: "Trailer has been delivered and is waiting to be collected.",
    badgeClassName: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    category: "customer",
    terminal: false,
    sortOrder: 140,
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance",
    description: "Trailer is blocked for maintenance or technical attention.",
    badgeClassName: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    category: "issue",
    terminal: false,
    sortOrder: 150,
  },
  departed: {
    id: "departed",
    label: "Departed",
    description: "Trailer has left the active yard workflow.",
    badgeClassName: "border-slate-500/30 bg-slate-500/10 text-slate-200",
    category: "historical",
    terminal: true,
    sortOrder: 160,
  },
  cancelled: {
    id: "cancelled",
    label: "Cancelled",
    description: "Movement or operation was cancelled and should not progress further.",
    badgeClassName: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    category: "historical",
    terminal: true,
    sortOrder: 170,
  },
};

export const OPERATIONAL_STAGE_ORDER = Object.values(OPERATIONAL_STAGE_CONFIG)
  .sort((left, right) => left.sortOrder - right.sortOrder)
  .map((stage) => stage.id);

export const ALLOWED_OPERATIONAL_TRANSITIONS: Record<OperationalStage, OperationalStage[]> = {
  expected: ["arrived", "cancelled"],
  arrived: ["inspection", "cancelled"],
  inspection: ["received", "hold", "cancelled"],
  received: ["compound", "local", "hold", "cancelled"],
  not_discharged: ["expected", "cancelled"],
  compound: ["allocated", "on_delivery", "maintenance", "departed", "cancelled"],
  local: ["compound", "allocated", "on_delivery", "maintenance", "departed", "cancelled"],
  hold: ["compound", "local", "maintenance", "cancelled"],
  allocated: ["delivered_empty", "cancelled"],
  delivered_empty: ["waiting_loading", "collected_loaded", "cancelled"],
  waiting_loading: ["collected_loaded", "cancelled"],
  collected_loaded: ["compound", "hold", "ready_for_shipping", "departed", "cancelled"],
  ready_for_shipping: ["loaded_on_vessel", "hold", "cancelled"],
  loaded_on_vessel: ["departed", "cancelled"],
  on_delivery: ["delivered", "cancelled"],
  delivered: ["waiting_collection", "cancelled"],
  waiting_collection: ["compound", "local", "cancelled"],
  maintenance: ["compound", "local", "cancelled"],
  departed: [],
  cancelled: [],
};

export const getOperationalStageConfig = (stage: OperationalStage) => OPERATIONAL_STAGE_CONFIG[stage];

export const getOperationalStageLabel = (stage: OperationalStage) => getOperationalStageConfig(stage).label;

export const getOperationalStageBadgeClassName = (stage: OperationalStage) => getOperationalStageConfig(stage).badgeClassName;

export const getAvailableNextStages = (stage: OperationalStage) => ALLOWED_OPERATIONAL_TRANSITIONS[stage] ?? [];

export const canTransition = (from: OperationalStage, to: OperationalStage) => getAvailableNextStages(from).includes(to);

export const getInvalidTransitionReason = (from: OperationalStage, to: OperationalStage) => {
  if (from === to) {
    return `Trailer is already in ${getOperationalStageLabel(from)}.`;
  }

  if (getOperationalStageConfig(from).terminal) {
    return `${getOperationalStageLabel(from)} is terminal in the canonical workflow.`;
  }

  if (!canTransition(from, to)) {
    return `${getOperationalStageLabel(to)} is not a valid next stage from ${getOperationalStageLabel(from)}.`;
  }

  return null;
};