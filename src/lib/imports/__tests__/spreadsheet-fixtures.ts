import * as XLSX from "xlsx";

const HEADERS = [
  "Trailer no.",
  "Length",
  "Cargo Description",
  "Priority",
  "Vessel",
  "Temp.",
  "Destination",
  "FS/PF",
  "Commodity",
  "Haz",
  "Unit Reg",
];

export const workbookToBytes = (workbook: XLSX.WorkBook) => {
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: false, bookSST: true });
  return new Uint8Array(buffer);
};

export const buildWorkbook = (sheetName: string, rows: Array<Array<string | number>>) => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return workbookToBytes(workbook);
};

export const buildVesselPresentationWorkbook = () =>
  buildWorkbook("FERRYSPEED VPL", [
    ["Ferryspeed Voyage Presentation List"],
    [],
    HEADERS,
    ["SHIPPING"],
    ["PFD1353", "13.6", "Chilled goods", "YES", "Arrow", "+2", "Portsmouth", "FS", "Food", "", "AB12CDE"],
    ["26330073", "13.6", "General cargo", "", "Arrow", "DRY", "Southampton", "PF", "Mixed", "", ""],
    ["MAIL18-10", "13.6", "Mail", "", "Arrow", "+2/+8", "Portsmouth", "FS", "Mail", "", ""],
    [],
    ["PFD1353", "13.6", "Duplicate shipping row", "YES", "Arrow", "+8", "Portsmouth", "FS", "Food", "", ""],
    ["STAND-BY"],
    ["PKD7", "13.6", "Stand-by cargo", "", "Arrow", "AMB", "Portsmouth", "FS", "Food", "", ""],
    [],
    ["OUTSTANDING"],
    ["FS72", "13.6", "Outstanding cargo", "", "Arrow", "DRY", "Portsmouth", "FS", "Food", "", ""],
    [],
    ["FINAL LIST"],
    ["Signature", "", "", "", "", "", "", "", "", "", ""],
  ]);

export const buildDeparturePresentationWorkbook = () =>
  buildWorkbook("FERRYSPEED VPL", [
    ["Ferryspeed Voyage Presentation List"],
    [],
    HEADERS,
    ["SHIPPING"],
    ["PRO810", "13.6", "Chilled goods", "", "Arrow", "+2", "Portsmouth", "FS", "Food", "YES", ""],
    ["3335066", "13.6", "General cargo", "", "Arrow", "AMB", "Southampton", "PF", "Mixed", "", ""],
    ["MAIL18-10", "13.6", "Mail", "", "Arrow", "DRY", "Portsmouth", "FS", "Mail", "", ""],
    [],
    ["CANCELLED"],
    ["PFC102", "13.6", "Cancelled cargo", "", "Arrow", "+2", "Portsmouth", "FS", "Food", "YES", ""],
    ["ADDITIONAL"],
    ["LOCAL01", "13.6", "Late addition", "", "Arrow", "+8", "Portsmouth", "FS", "Food", "", ""],
    ["STAND-BY"],
    ["CR443", "13.6", "Stand-by cargo", "", "Arrow", "AMB", "Portsmouth", "FS", "Food", "", ""],
    [],
    ["OUTSTANDING"],
    ["PKD31", "13.6", "Outstanding cargo", "", "Arrow", "DRY", "Portsmouth", "FS", "Food", "", ""],
    ["FINAL LIST"],
  ]);
