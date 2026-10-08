import * as XLSX from "xlsx";

export type SpreadsheetExtraction = {
  text: string;
  sheets: { name: string; rows: number; columns: number }[];
};

export function extractSpreadsheet(bytes: Buffer): SpreadsheetExtraction {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, dense: true });
  const sheets: SpreadsheetExtraction["sheets"] = [];
  const chunks: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
    const nonEmpty = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const columns = nonEmpty.reduce((max, row) => Math.max(max, row.length), 0);
    sheets.push({ name: sheetName, rows: nonEmpty.length, columns });
    chunks.push(`Лист: ${sheetName}`);
    for (const row of nonEmpty.slice(0, 5000)) {
      chunks.push(row.map((cell) => String(cell ?? "").trim()).join(" | "));
    }
  }
  return { text: chunks.join("\n"), sheets };
}
