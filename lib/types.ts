export const PIPELINE_VERSION = "2026-10-08.9";

export const REGIONS = ["RU", "EU", "US"] as const;
export type Region = (typeof REGIONS)[number];

export type DocumentStatus =
  | "queued"
  | "ready"
  | "anonymization_unconfirmed"
  | "failed";

export type MedicalDocument = {
  visualAnalysis?: {
    status: "ready" | "unavailable";
    totalFrames: number;
    analyzedFrames: number[];
    coverage: "complete" | "sampled";
    limitations: string[];
    findings: NonNullable<import("./image-json").ImageReading["visualFindings"]>;
  };
  id: string;
  fileName: string;
  byteSize: number;
  contentHash: string;
  pipelineVersion: string;
  status: DocumentStatus;
  statusLabel: string;
  note: string;
  studyDate: string | null;
  anonymizedText: string;
  createdAt: string;
};

export type FactStatus = "extracted" | "conflicting" | "uncertain";
export type DateStatus = "known" | "unknown";

export type MedicalFact = {
  id: string;
  documentId: string;
  concept: string;
  label: string;
  value: number;
  valueText: string;
  unit: string;
  date: string | null;
  dateStatus: DateStatus;
  referenceLow: number | null;
  referenceHigh: number | null;
  line: number;
  excerpt: string;
  extraction: "text";
  status: FactStatus;
};

export type MedicationMention = {
  id: string;
  documentId: string;
  name: string;
  dose: number;
  doseText: string;
  unit: string;
  frequency?: string;
  date: string | null;
  line: number;
  excerpt: string;
};

export type DocumentIssue = {
  id: string;
  documentId: string;
  description: string;
  line: number;
  excerpt: string;
  otherLine?: number;
  otherExcerpt?: string;
};

export type SourceRef = {
  documentId: string;
  documentName: string;
  line: number;
  excerpt: string;
};

export type TimelineEvent = {
  date: string | null;
  dateStatus: DateStatus;
  kind: "measurement" | "medication";
  text: string;
  source: SourceRef;
};

export type ReportBlock = {
  title: string;
  body: string;
  lead?: string;
  sources: SourceRef[];
  notes?: { model: string; label: string; text: string }[];
};

export type ReportView = {
  extractionProblems?: ReportBlock[];
  measurementHistory?: import("./measurement-history").MeasurementHistory[];
  instrumentStudies?: import("./instrument-studies").InstrumentStudy[];
  imagingStudies?: { documentId: string; documentName: string; status: "ready" | "unavailable"; totalFrames: number; analyzedFrames: number[]; coverage: "complete" | "sampled"; limitations: string[] }[];
  clinicalSynthesis?: import("./clinical-synthesis").ClinicalSynthesis;
  generatedAt: string;
  inputHash: string;
  region: Region;
  pipelineVersion: string;
  status: "ready" | "blocked" | "empty";
  blockReasons: string[];
  headline: string;
  intro: string;
  documents: { id: string; name: string; statusLabel: string; note: string }[];
  guidelineNote: string;
  catalog?: { organization: string; title: string; version: string; publicationDate: string; standing: "current" | "kept"; origin: "selected" | "offered"; place: string; url?: string; population?: string; targetValue?: string; targetUnit?: string }[];
  guidelineSearch?: string;
  themes: ReportBlock[];
  changes: ReportBlock[];
  conflicts: ReportBlock[];
  gaps: string[];
  questions: string[];
  relationships: ReportBlock[];
  timeline?: TimelineEvent[];
  cannotSay: string[];
  limits: string[];
  imageReadings?: { name: string; json: string }[];
  wording?: { model: string; label: string; text: string }[];
  modelsReady?: boolean;
  clinicalQuality?: { score: number; verdict: "pass" | "review" | "block"; evaluatorModels: string[]; blockerCount: number };
  axisResults?: { axisId: string; title: string; status: "sufficient_data" | "partial_data" | "insufficient_data"; factCount: number; trendCount: number; conflictCount: number; missingCount: number }[];
};

export type StoredReport = ReportView & { id: string };

export type AuditEvent = {
  at: string;
  action: "upload" | "view" | "generate" | "delete" | "process";
  target?: string;
};

export type ReviewFinding = {
  id: string;
  createdAt: string;
  type: "outdated_guideline" | "dose" | "target" | "document_error" | "missed_question" | "missed_link" | "unclear" | "out_of_scope" | "other";
  quote: string;
  why: string;
  shouldBe: string;
  organization: string;
  guidelineTitle: string;
  version: string;
  year: string;
  severity: "blocker" | "fix" | "language";
};

export type JobRecord = {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "failed";
  at: string;
  documentId?: string;
  origin?: "phone" | "computer";
};

export type ChatMode = "analysis" | "general";

export type ChatTurn = {
  mode?: ChatMode;
  sources?: { title: string; url: string; pmid: string; year: string }[];
  role: "user" | "assistant";
  text: string;
  at: string;
};

export type OwnerState = {
  region: Region;
  documents: MedicalDocument[];
  facts: MedicalFact[];
  medications: MedicationMention[];
  issues: DocumentIssue[];
  report: ReportView | null;
  reports: StoredReport[];
  reviews: ReviewFinding[];
  jobs: JobRecord[];
  audit: AuditEvent[];
  chat: ChatTurn[];
};

export function emptyState(): OwnerState {
  return {
    region: "RU",
    documents: [],
    facts: [],
    medications: [],
    issues: [],
    report: null,
    reports: [],
    reviews: [],
    jobs: [],
    audit: [],
    chat: [],
  };
}
