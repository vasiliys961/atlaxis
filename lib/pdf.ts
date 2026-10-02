export async function extractPdfText(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: true });
  if (Array.isArray(extracted.text)) return extracted.text.join("\n");
  return extracted.text ?? "";
}
