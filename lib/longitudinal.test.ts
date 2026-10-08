import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "./parse";

test("longitudinal measurements in one document are not conflicting", () => {
  const parsed = parseDocument("Дата исследования: 2024-01-01\nЛПНП 4.8 ммоль/л\nДата исследования: 2025-01-01\nЛПНП 3.1 ммоль/л");
  assert.equal(parsed.facts.length, 2);
  assert.equal(parsed.facts[0]?.date, "2024-01-01");
  assert.equal(parsed.facts[1]?.date, "2025-01-01");
  assert.equal(parsed.issues.some(issue => issue.description.includes("записан по-разному")), false);
});

test("disagreeing values for same date remain flagged", () => {
  const parsed = parseDocument("Дата исследования: 2025-01-01\nЛПНП 4.8 ммоль/л\nЛПНП 3.1 ммоль/л");
  assert.equal(parsed.issues.some(issue => issue.description.includes("записан по-разному")), true);
});
