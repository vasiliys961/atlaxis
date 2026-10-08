import test from "node:test";
import assert from "node:assert/strict";
import { guidelineRegion, retrieveGuidelineSources } from "./guideline-sources";
test("primary source retrieval rejects arbitrary hosts, credentials and ports", () => {
  for (const u of ["http://escardio.org", "https://escardio.org.evil.test", "https://localhost", "https://user@escardio.org", "https://escardio.org:1234"]) assert.equal(guidelineRegion(u), null);
  assert.equal(guidelineRegion("https://www.escardio.org/Guidelines"), "EU");
  assert.equal(guidelineRegion("https://cr.minzdrav.gov.ru/"), "RU");
});
test("retrieved primary page is not marked latest verified; redirects are refused", async () => {
  const old = global.fetch;
  global.fetch = (async (u: any, options: any) => { assert.equal(options.redirect, "manual"); return String(u).includes("escardio") ? new Response("<html><script>unsafe()</script><p>Guideline text</p></html>", { headers: {"content-type":"text/html"} }) : new Response(null, { status:302,headers:{location:"http://localhost"} }); }) as typeof fetch;
  try { const sources = await retrieveGuidelineSources("https://escardio.org/Guidelines https://acc.org/Guidelines https://evil.test/"); assert.equal(sources.length,2); assert.equal(sources[0].status,"retrieved"); assert.equal(sources[0].latestEditionVerified,false); assert.equal(sources[0].excerpt,"Guideline text"); assert.equal(sources[1].status,"unavailable"); }
  finally { global.fetch = old; }
});
