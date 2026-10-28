import test from "node:test";
import assert from "node:assert/strict";
import { renderPdfPages } from "./pdf-pages";

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 100 Td (Hello) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000228 00000 n 
0000000320 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
399
%%EOF`;

test("a pdf page renders to a jpeg for reading", async () => {
  const rendered = await renderPdfPages(Buffer.from(PDF));
  assert.equal(rendered.totalPages, 1);
  assert.equal(rendered.pages.length, 1);
  assert.equal(rendered.pages[0]?.bytes[0], 0xff);
  assert.equal(rendered.pages[0]?.bytes[1], 0xd8);
});
