import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./data-root";
import { withOwner } from "./store";

test("missing patient history initializes without error", async () => {
  const owner = randomUUID();
  const dir = path.join(dataRoot(), owner);
  try {
    const count = await withOwner(owner, async state => state.documents.length);
    assert.equal(count, 0);
    assert.ok(JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupted patient history is never silently replaced with empty state", async () => {
  const owner = randomUUID();
  const dir = path.join(dataRoot(), owner);
  const filename = path.join(dir, "state.json");
  const corrupt = "{not valid json";
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filename, corrupt);
    await assert.rejects(withOwner(owner, async state => { state.chat = []; }), SyntaxError);
    assert.equal(await readFile(filename, "utf8"), corrupt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
