import convert from "heic-convert";

const BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]);

export function isHeicContainer(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  return BRANDS.has(bytes.subarray(8, 12).toString("ascii").toLowerCase());
}

export function jpegName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).slice(0, 76);
  return `${stem || "photo"}.jpg`;
}

export async function heicToJpeg(bytes: Buffer): Promise<Buffer> {
  const copy = Uint8Array.from(bytes);
  const output = await convert({ buffer: copy, format: "JPEG", quality: 0.9 });
  const jpeg = Buffer.from(output);
  if (jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("heic jpeg");
  }
  return jpeg;
}
