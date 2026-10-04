import mammoth from "mammoth";

const ENTRY = Buffer.from("word/document.xml");

export function looksLikeDocx(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return false;
  if (bytes.subarray(0, Math.min(bytes.length, 2_000_000)).includes(ENTRY)) return true;
  return bytes.length > 65_536 && bytes.subarray(-65_536).includes(ENTRY);
}

export function looksLikeLegacyDoc(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1";
}

export async function extractDocxText(bytes: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value.replace(/\u0000/g, "").trim();
}
