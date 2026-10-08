import dicomParser from "dicom-parser";

export type DicomExtraction = {
  text: string;
  studyDate: string | null;
  modality: string | null;
  tags: Record<string, string>;
};

const TAGS: Record<string, string> = {
  "x00100010": "PatientName",
  "x00080020": "StudyDate",
  "x00080060": "Modality",
  "x00081030": "StudyDescription",
  "x0008103e": "SeriesDescription",
  "x00180015": "BodyPartExamined",
  "x0020000d": "StudyInstanceUID",
  "x0020000e": "SeriesInstanceUID",
};

function value(dataSet: any, tag: string): string {
  try { return String(dataSet.string(tag) ?? "").trim(); } catch { return ""; }
}

export function extractDicom(bytes: Buffer): DicomExtraction {
  const dataSet = dicomParser.parseDicom(new Uint8Array(bytes));
  const tags: Record<string, string> = {};
  for (const [tag, name] of Object.entries(TAGS)) {
    const v = value(dataSet, tag);
    if (v) tags[name] = v;
  }

  const lines = [
    tags.StudyDate ? `Дата исследования: ${tags.StudyDate}` : "",
    tags.Modality ? `Модальность: ${tags.Modality}` : "",
    tags.StudyDescription ? `Исследование: ${tags.StudyDescription}` : "",
    tags.SeriesDescription ? `Серия: ${tags.SeriesDescription}` : "",
    tags.BodyPartExamined ? `Область исследования: ${tags.BodyPartExamined}` : "",
  ].filter(Boolean);

  return {
    text: lines.join("\n"),
    studyDate: /^\d{8}$/.test(tags.StudyDate ?? "")
      ? `${tags.StudyDate!.slice(0,4)}-${tags.StudyDate!.slice(4,6)}-${tags.StudyDate!.slice(6,8)}`
      : null,
    modality: tags.Modality ?? null,
    tags,
  };
}
