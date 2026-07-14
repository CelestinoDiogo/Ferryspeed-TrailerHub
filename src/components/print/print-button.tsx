"use client";

type PrintButtonProps = {
  label?: string;
  disabled?: boolean;
  onPrint?: () => void;
  className?: string;
};

export function PrintButton({
  label = "Print / Export",
  disabled = false,
  onPrint,
  className = "",
}: PrintButtonProps) {
  const handleClick = () => {
    if (onPrint) {
      onPrint();
      return;
    }

    window.print();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`screen-only inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M7 9V4h10v5M7 17v3h10v-3M6 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 13h8M8 15h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}