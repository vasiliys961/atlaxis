import sharp from "sharp";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

export const MAX_PDF_PAGES = 8;

export type PdfPageImage = { bytes: Buffer; mime: "image/jpeg"; index: number };

export async function renderPdfPages(bytes: Buffer): Promise<{ pages: PdfPageImage[]; totalPages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const totalPages = pdf.numPages;
  const count = Math.min(totalPages, MAX_PDF_PAGES);
  const pages: PdfPageImage[] = [];
  for (let page = 1; page <= count; page += 1) {
    const png = Buffer.from(await renderPageAsImage(pdf, page, {
      width: 1400,
      canvasImport: () => import("@napi-rs/canvas"),
    }));
    let jpeg = await sharp(png).jpeg({ quality: 75 }).toBuffer();
    if (jpeg.length > 700_000) jpeg = await sharp(png).jpeg({ quality: 52 }).toBuffer();
    if (jpeg.length > 900_000) continue;
    pages.push({ bytes: jpeg, mime: "image/jpeg", index: page - 1 });
  }
  return { pages, totalPages };
}
