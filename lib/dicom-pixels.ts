import dicomParser from "dicom-parser";
import sharp from "sharp";

export type DicomFrame = { index: number; png: Buffer; window: string };
export type DicomPixels = {
  modality: string; totalFrames: number; frames: DicomFrame[];
  coverage: "complete" | "sampled"; canSend: boolean; limitations: string[];
};
const NATIVE = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"]);
const FRAME_LIMIT = 12;

export function selectFrameIndices(total: number): number[] {
  if (!Number.isInteger(total) || total < 1 || total > 10000) throw new Error("Некорректное число кадров DICOM.");
  const count = Math.min(total, FRAME_LIMIT);
  return Array.from({ length: count }, (_, i) => count === 1 ? 0 : Math.round(i * (total - 1) / (count - 1)));
}
export function windowPixel(value: number, center: number, width: number, invert = false): number {
  if (!Number.isFinite(value) || !Number.isFinite(center) || !Number.isFinite(width) || width < 1) throw new Error("Некорректное окно DICOM.");
  const low = center - 0.5 - (width - 1) / 2;
  const high = center - 0.5 + (width - 1) / 2;
  const shown = value <= low ? 0 : value > high ? 255 : ((value - (center - 0.5)) / (width - 1) + 0.5) * 255;
  return Math.round(invert ? 255 - shown : shown);
}

// Derives pixel-only PNGs locally. No original DICOM tags, private fields or overlays
// are exported. Burned-in pixels still require an explicit source declaration.
export async function renderDicomFrames(bytes: Buffer): Promise<DicomPixels> {
  const ds = dicomParser.parseDicom(new Uint8Array(bytes));
  const tag = (id: string) => (ds.string(id) ?? "").trim();
  const syntax = tag("x00020010");
  const pixel = ds.elements.x7fe00010;
  const rows = ds.uint16("x00280010") ?? 0, cols = ds.uint16("x00280011") ?? 0;
  if (!pixel || rows < 1 || cols < 1 || rows * cols > 4_000_000) throw new Error("DICOM не содержит допустимого пиксельного кадра.");
  if (ds.elements.x52009229 || ds.elements.x52009230) throw new Error("Enhanced DICOM с функциональными группами пока не поддержан; геометрия и преобразования не предполагаются.");
  const totalFrames = Number(tag("x00280008") || 1);
  const indices = selectFrameIndices(totalFrames);
  const photo = tag("x00280004");
  const samples = ds.uint16("x00280002") ?? 1;
  const bits = ds.uint16("x00280100") ?? 0;
  const stored = ds.uint16("x00280101") ?? bits;
  const high = ds.uint16("x00280102") ?? stored - 1;
  const signed = ds.uint16("x00280103") ?? 0;
  if (signed !== 0 && signed !== 1) throw new Error("Неподдерживаемое представление пикселей.");
  const rgb = photo === "RGB" && samples === 3 && bits === 8 && (ds.uint16("x00280006") ?? 0) === 0;
  const mono = ["MONOCHROME1", "MONOCHROME2"].includes(photo) && samples === 1 && [8, 16].includes(bits);
  if (!rgb && !mono && syntax !== "1.2.840.10008.1.2.4.50") throw new Error("Цветовая схема или разрядность DICOM пока не поддержана.");
  if (rgb && (stored !== 8 || signed !== 0)) throw new Error("Некорректные разряды RGB DICOM.");
  if (syntax === "1.2.840.10008.1.2.4.50" && (bits !== 8 || ![1, 3].includes(samples) || !["MONOCHROME1", "MONOCHROME2", "RGB", "YBR_FULL", "YBR_FULL_422"].includes(photo))) throw new Error("Неподдерживаемый JPEG baseline DICOM.");
  if (mono && (stored < 1 || stored > bits || high !== stored - 1)) throw new Error("Неподдерживаемое выравнивание разрядов DICOM.");
  if (ds.elements.x00283000 || ds.elements.x00283010) throw new Error("DICOM LUT требует отдельного декодера; упрощённое изображение не создаётся.");
  const voi = tag("x00281056");
  if (voi && voi !== "LINEAR") throw new Error("Неподдерживаемая функция VOI DICOM.");
  const readNumber = (id: string, fallback: number) => { const raw = tag(id); const n = raw ? Number(raw.split("\\")[0]) : fallback; if (!Number.isFinite(n)) throw new Error("Некорректное числовое преобразование DICOM."); return n; };
  const slope = readNumber("x00281053", 1), intercept = readNumber("x00281052", 0);
  if (slope === 0) throw new Error("Нулевой Rescale Slope DICOM.");
  const declaredCenter = tag("x00281050"), declaredWidth = tag("x00281051");
  if (Boolean(declaredCenter) !== Boolean(declaredWidth)) throw new Error("Неполная пара окна DICOM.");
  const byteCount = rows * cols * samples * bits / 8;
  if (NATIVE.has(syntax) && (!Number.isInteger(byteCount) || pixel.length < byteCount * totalFrames || pixel.dataOffset + byteCount * totalFrames > bytes.length)) throw new Error("Пиксельные данные DICOM усечены.");
  const limitations = ["Визуальные наблюдения ИИ требуют проверки специалистом; PNG не заменяет исходную серию."];
  if (mono) limitations.push("Кадры представлены в одном окне яркости; другие окна могут выявить иные изменения.");
  const canSend = tag("x00280301") === "NO" && tag("x00280302") !== "YES";
  if (!canSend) limitations.push("Отсутствие идентифицирующих надписей в пикселях не подтверждено; кадры во внешнюю модель не отправлены.");
  if (totalFrames > FRAME_LIMIT) limitations.push("Анализируется выборка кадров, не вся серия; отсутствие находок не исключает патологию.");
  const frames: DicomFrame[] = [];
  for (const index of indices) {
    if (syntax === "1.2.840.10008.1.2.4.50") {
      const encoded = dicomParser.readEncapsulatedImageFrame(ds, pixel, index);
      const decoder = sharp(Buffer.from(encoded), { limitInputPixels: 4_000_000 });
      const meta = await decoder.metadata();
      if (meta.width !== cols || meta.height !== rows) throw new Error("Размер JPEG-кадра не совпадает с DICOM.");
      if (photo === "MONOCHROME1") decoder.negate();
      frames.push({ index, png: await decoder.png().toBuffer(), window: "JPEG baseline" });
      continue;
    }
    if (!NATIVE.has(syntax)) throw new Error("Сжатие DICOM не поддержано: нужен совместимый декодер этого Transfer Syntax.");
    const offset = pixel.dataOffset + index * byteCount;
    if (rgb) {
      frames.push({ index, png: await sharp(bytes.subarray(offset, offset + byteCount), { raw: { width: cols, height: rows, channels: 3 } }).png().toBuffer(), window: "RGB" });
      continue;
    }
    const values = new Float64Array(rows * cols);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      let raw = bits === 8 ? bytes[offset + i]! : syntax === "1.2.840.10008.1.2.2" ? bytes.readUInt16BE(offset + i * 2) : bytes.readUInt16LE(offset + i * 2);
      raw &= (2 ** stored - 1);
      if (signed && raw >= 2 ** (stored - 1)) raw -= 2 ** stored;
      const value = raw * slope + intercept;
      values[i] = value; min = Math.min(min, value); max = Math.max(max, value);
    }
    const center = declaredCenter ? readNumber("x00281050", 0) : (min + max + 1) / 2;
    const width = declaredWidth ? readNumber("x00281051", 1) : max - min + 1;
    const shown = Buffer.alloc(values.length);
    for (let i = 0; i < values.length; i++) shown[i] = windowPixel(values[i]!, center, width, photo === "MONOCHROME1");
    frames.push({ index, png: await sharp(shown, { raw: { width: cols, height: rows, channels: 1 } }).png().toBuffer(), window: declaredCenter ? `DICOM window ${center}/${width}` : "auto min/max" });
  }
  return { modality: tag("x00080060"), totalFrames, frames, coverage: totalFrames === frames.length ? "complete" : "sampled", canSend, limitations };
}
