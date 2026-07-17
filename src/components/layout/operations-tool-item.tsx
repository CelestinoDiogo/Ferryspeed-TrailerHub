import { ExternalLink, Anchor, CloudSun, Map, Phone, Ship, TrafficCone, Waves } from "lucide-react";
import type { ComponentType } from "react";
import type { OperationsTool, OperationsToolIcon } from "@/config/operations-tools";

type OperationsToolItemProps = {
  tool: OperationsTool;
};

const iconMap: Record<OperationsToolIcon, ComponentType<{ className?: string }>> = {
  map: Map,
  traffic: TrafficCone,
  cloud: CloudSun,
  waves: Waves,
  ship: Ship,
  anchor: Anchor,
  phone: Phone,
};

export function OperationsToolItem({ tool }: OperationsToolItemProps) {
  const Icon = iconMap[tool.icon];

  return (
    <a
      href={tool.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${tool.label} (opens in a new tab)`}
      className="group flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{tool.label}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{tool.description}</span>
        </span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-600" />
    </a>
  );
}