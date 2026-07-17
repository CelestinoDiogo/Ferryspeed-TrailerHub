import Link from "next/link";
import { Construction } from "lucide-react";

type ComingSoonPageProps = {
  title: string;
  description: string;
  backHref?: string;
};

export function ComingSoonPage({ title, description, backHref = "/dashboard" }: ComingSoonPageProps) {
  return (
    <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_16px_36px_rgba(15,23,42,0.06)]">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
        <Construction className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
      <p className="mt-2 text-slate-600">{description}</p>
      <p className="mt-1 text-sm text-slate-500">This is a safe placeholder page for the current navigation sprint.</p>
      <Link
        href={backHref}
        className="mt-6 inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Back to Dashboard
      </Link>
    </section>
  );
}