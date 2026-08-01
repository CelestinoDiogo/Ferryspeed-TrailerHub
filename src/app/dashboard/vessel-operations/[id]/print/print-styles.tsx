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

        .vessel-print-report table {
          width: 100% !important;
          table-layout: fixed;
        }

        .vessel-print-report th,
        .vessel-print-report td {
          white-space: normal !important;
          word-break: break-word;
          overflow-wrap: anywhere;
          vertical-align: top;
        }

        .vessel-print-report .print-photo-grid {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 10px !important;
        }

        .vessel-print-report .print-photo-card,
        .vessel-print-report .print-photo-frame {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }

        .vessel-print-report .print-photo-frame {
          max-height: 95mm !important;
          min-height: 60mm !important;
        }

        .vessel-print-report .print-photo-frame img {
          object-fit: contain !important;
          max-height: 95mm !important;
          width: 100% !important;
        }

        .vessel-print-report h2,
        .vessel-print-report h3 {
          break-after: avoid-page;
          page-break-after: avoid;
        }
      }
    `}</style>
  );
}
