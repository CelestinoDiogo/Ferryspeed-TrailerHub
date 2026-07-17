import { AppCard } from "@/components/layout/app-card";

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = "Loading operations dashboard..." }: LoadingStateProps) {
  return (
    <AppCard>
      <div className="flex min-h-[280px] items-center justify-center p-6 text-sm text-slate-600">{label}</div>
    </AppCard>
  );
}