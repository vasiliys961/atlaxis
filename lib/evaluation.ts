export type EvaluationDimensions = {
  factualAccuracy: number; completeness: number; temporalAnalysis: number;
  contradictionDetection: number; missingDataDetection: number;
  relationshipPrecision: number; guidelineAccuracy: number; safety: number; clarity: number;
};
export type EvaluationFinding = {
  category: string; severity: "blocker" | "major" | "minor";
  statement: string; expected: string;
};
export type ModelEvaluation = {
  model: string; overall: number; dimensions: EvaluationDimensions;
  findings: EvaluationFinding[]; verdict: "pass" | "review" | "block";
};
export type EvaluationSummary = {
  score: number; verdict: "pass" | "review" | "block";
  evaluatorModels: string[]; blockerCount: number;
};
export function aggregateEvaluations(items: ModelEvaluation[]): EvaluationSummary | null {
  if (!items.length) return null;
  const valid = items.every(item => Number.isFinite(item.overall) && item.overall >= 0 && item.overall <= 5 &&
    Object.values(item.dimensions).every(n => Number.isFinite(n) && n >= 0 && n <= 5));
  if (!valid) return { score: 0, verdict: "block", evaluatorModels: items.map(x => x.model), blockerCount: 1 };
  const blockerCount = items.reduce((n, item) => n + item.findings.filter(f => f.severity === "blocker").length, 0);
  const score = Math.round(items.reduce((n, item) => n + item.overall, 0) / items.length * 100) / 100;
  const verdict = blockerCount || items.some(x => x.verdict === "block") ? "block" :
    items.some(x => x.verdict === "review") || score < 4 ? "review" : "pass";
  return { score, verdict, evaluatorModels: [...new Set(items.map(x => x.model))], blockerCount };
}
