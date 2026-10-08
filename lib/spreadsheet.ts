import * as XLSX from "xlsx";

export type SpreadsheetExtraction = {
  text: string;
  sheets: { name: string; rows: number; columns: number }[];
};

// Reject oversized workbooks instead of silently omitting clinical measurements.
const MAX_SHEETS = 30;
const MAX_ROWS_PER_SHEET = 5000;
const MAX_COLUMNS = 200;
const MAX_TOTAL_CHARS = 1_000_000;

export function extractSpreadsheet(bytes: Buffer): SpreadsheetExtraction {
  const workbook = XLSX.read(bytes, {
    type: "buffer",
    cellDates: true,
    dense: true,
    bookVBA: false,
    cellFormula: false,
    cellHTML: false,
  });
  if (workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error("spreadsheet_too_many_sheets");
  }
  const sheets: SpreadsheetExtraction["sheets"] = [];
  const chunks: string[] = [];
  let totalChars = 0;
  const append = (line: string) => {
    totalChars += line.length + 1;
    if (totalChars > MAX_TOTAL_CHARS) throw new Error("spreadsheet_text_limit");
    chunks.push(line);
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    if (range && (range.e.r - range.s.r + 1 > MAX_ROWS_PER_SHEET ||
      range.e.c - range.s.c + 1 > MAX_COLUMNS)) {
      throw new Error("spreadsheet_dimensions_limit");
    }
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1, raw: false, defval: "", blankrows: false,
    }) as unknown[][];
    const nonEmpty = rows.filter((row) =>
      row.some((cell) => String(cell ?? "").trim() !== ""));
    if (nonEmpty.length > MAX_ROWS_PER_SHEET ||
      nonEmpty.some((row) => row.length > MAX_COLUMNS)) {
      throw new Error("spreadsheet_dimensions_limit");
    }
    const columns = nonEmpty.reduce((max, row) => Math.max(max, row.length), 0);
    sheets.push({ name: sheetName, rows: nonEmpty.length, columns });
    append(`Лист: ${sheetName}`);
    for (const row of nonEmpty) {
      append(row.map((cell) => String(cell ?? "").replace(/[\r\n|]+/g, " ").trim()).join(" | "));
    }
  }
  return { text: chunks.join("\n"), sheets };
}
