import { z } from "zod";

export const reviewSchema = z.object({
  type: z.enum(["outdated_guideline", "dose", "target", "document_error", "missed_question", "missed_link", "unclear", "out_of_scope", "other"]),
  quote: z.string().trim().min(8),
  why: z.string().trim().min(8),
  shouldBe: z.string().trim().min(8),
  organization: z.string().trim().min(2),
  guidelineTitle: z.string().trim().min(2),
  version: z.string().trim().min(1),
  year: z.string().regex(/^\d{4}$/),
  severity: z.enum(["blocker", "fix", "language"]),
}).refine((value) => !/в целом нормально/i.test(`${value.quote} ${value.why} ${value.shouldBe}`), {
  message: "Нужна конкретная находка, а не общая оценка.",
});
