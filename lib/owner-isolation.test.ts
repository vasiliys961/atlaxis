import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./data-root";
import { withOwner } from "./store";

test("rejects malformed owner identifier before accessing patient data", async () => {
  await assert.rejects(withOwner("invalid-owner", async () => 1), /invalid_owner_id/);
});

test("rejects malformed document collection without replacing saved content", async () => {
  const owner = randomUUID();
  const folder = path.join(dataRoot(), owner);
  const filename = path.join(folder, "state.json");
  const original = JSON.stringify({ documents: { invalid: true } });
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(filename, original);
    await assert.rejects(withOwner(owner, async () => 1), /owner_state_corrupt/);
    assert.equal(await readFile(filename, "utf8"), original);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
