import dicomParser from "dicom-parser";

/**
 * Strict allowlist: only non-identifying structured DICOM fields enter the
 * clinical text pipeline. Never return patient names, UIDs, institution,
 * operator or free-text descriptions; those can contain identifiers.
 * This does NOT de-identify the original binary DICOM file.
 */
export type DicomExtraction = {
  text: string;
  studyDate: string | null;
  modality: string | null;
  tags: Record<string, string>;
};

function readTag(dataSet: ReturnType<typeof dicomParser.parseDicom>, tag: string): string {
  try { return (dataSet.string(tag) ?? "").trim(); } catch { return ""; }
}

function validDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function extractDicom(bytes: Buffer): DicomExtraction {
  const dataSet = dicomParser.parseDicom(new Uint8Array(bytes));
  const studyDate = validDate(readTag(dataSet, "x00080020"));
  const rawModality = readTag(dataSet, "x00080060");
  const modality = /^[A-Z]{1,8}$/.test(rawModality) ? rawModality : null;
  const tags: Record<string, string> = {};
  if (studyDate) tags.StudyDate = studyDate;
  if (modality) tags.Modality = modality;
  const text = [
    studyDate ? `Дата исследования: ${studyDate}` : "",
    modality ? `Модальность: ${modality}` : "",
  ].filter(Boolean).join("\n");
  return { text, studyDate, modality, tags };
}
