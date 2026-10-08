import assert from "node:assert/strict";
import test from "node:test";
import { parsePhoneLinks } from "./phone-link";

test("upload-link registry rejects truncated JSON", () => {
  assert.throws(() => parsePhoneLinks('{"links":'), /phone_links_corrupt/);
});

test("upload-link registry rejects malformed entries", () => {
  assert.throws(() => parsePhoneLinks(JSON.stringify({ links: [{ code: "abc", ownerId: 123, expiresAt: 1 }] })), /phone_links_corrupt/);
});

test("valid empty upload-link registry is accepted", () => {
  assert.deepEqual(parsePhoneLinks('{"links":[]}'), []);
});
