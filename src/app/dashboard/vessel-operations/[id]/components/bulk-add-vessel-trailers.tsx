type BulkAddVesselTrailersProps = {
  editable: boolean;
  isSaving: boolean;
  bulkText: string;
  setBulkText: (value: string) => void;
  onBulkAdd: () => Promise<void>;
};

export function BulkAddVesselTrailers({
  editable,
  isSaving,
  bulkText,
  setBulkText,
  onBulkAdd,
}: BulkAddVesselTrailersProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Bulk Add Trailers</p>
      <textarea
        value={bulkText}
        onChange={(event) => setBulkText(event.target.value)}
        rows={5}
        className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
        placeholder="One trailer number per line"
        disabled={!editable}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onBulkAdd()}
          disabled={isSaving || !editable}
          className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-60"
        >
          Add Multiple Trailers
        </button>
      </div>
    </section>
  );
}
