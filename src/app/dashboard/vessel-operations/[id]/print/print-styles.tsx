"use client";

export function VesselPrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        @page {
          size: A4 portrait;
          margin: 10mm;
        }

        .vessel-print-actions,
        .screen-only {
          display: none !important;
        }

        body {
          background: #ffffff !important;
        }

        .vessel-print-report {
          background: #ffffff !important;
          color: #111827 !important;
          box-shadow: none !important;
          border: none !important;
          margin: 0 !important;
          max-width: none !important;
        }

        .vessel-print-report .avoid-print-break,
        .vessel-print-report tr,
        .vessel-print-report .trailer-print-card,
        .vessel-print-report .detail-print-card {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
      }
    `}</style>
  );
}
