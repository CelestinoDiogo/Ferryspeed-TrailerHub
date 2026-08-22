export const CSV_UTF8_BOM = "\uFEFF";

export const escapeCsvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
};

export const buildCsv = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return `${CSV_UTF8_BOM}${lines.join("\r\n")}\r\n`;
};

export const historicalCsvFileName = (reportType: string, dateKey: string) => {
  const safeType = reportType.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : "export";
  return `ferryspeed-${safeType}-${safeDate}.csv`;
};

export const downloadCsv = (fileName: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
