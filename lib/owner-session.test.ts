import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createOwnerSession, verifyOwnerSession } from "./owner-session";

const secret = "test-secret-with-at-least-32-characters-long";
test("valid signed owner session is accepted", async () => {
  const id = randomUUID();
  const token = await createOwnerSession(id, secret, 1000000000000);
  assert.equal(await verifyOwnerSession(token, secret, 1000000000001), id);
});
test("unsigned and tampered owner sessions are rejected", async () => {
  const id = randomUUID();
  assert.equal(await verifyOwnerSession(id, secret), null);
  const token = await createOwnerSession(id, secret, 1000000000000);
  assert.equal(await verifyOwnerSession(token.replace(id, randomUUID()), secret, 1000000000001), null);
});
test("expired owner session is rejected", async () => {
  const token = await createOwnerSession(randomUUID(), secret, 1000000000000);
  assert.equal(await verifyOwnerSession(token, secret, 1000000000000 + 31 * 86400000), null);
});
