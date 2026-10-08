export const MAX_VIDEO_PAGES = 8;
export const MAX_VIDEO_SECONDS = 90;
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export type VideoPage = { file: File; preview: string; seconds: number; sharpness: number };
export function sampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) throw new Error("Видео должно длиться не более 90 секунд.");
  return Array.from({ length: Math.min(60, Math.max(1, Math.ceil(duration / 1.5))) }, (_, i) => Math.min(duration - 0.01, i * 1.5)).map(t => Math.max(0, t));
}
export function frameSharpness(rgba: Uint8ClampedArray, width: number, height: number): number {
  const gray = (x: number, y: number) => { const i = (y * width + x) * 4; return (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3; };
  let sum = 0, count = 0;
  for (let y = 1; y < height - 1; y += 3) for (let x = 1; x < width - 1; x += 3) { const lap = gray(x-1,y)+gray(x+1,y)+gray(x,y-1)+gray(x,y+1)-4*gray(x,y); sum += lap * lap; count++; }
  return count ? Math.round(sum / count) : 0;
}
function event(video: HTMLVideoElement, name: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener(name, done); video.removeEventListener("error", fail); signal.removeEventListener("abort", fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(signal.aborted ? "Выбор кадров отменён." : "Браузер не смог прочитать видео. Попробуйте MP4 или обычные фотографии.")); };
    const timer = window.setTimeout(fail, 15000);
    video.addEventListener(name, done, { once: true }); video.addEventListener("error", fail, { once:true }); signal.addEventListener("abort", fail, { once:true });
    if (signal.aborted) fail();
  });
}
export async function extractVideoPages(file: File, signal: AbortSignal, progress: (count:number,total:number)=>void): Promise<{ pages:VideoPage[]; duplicates:number; skipped:number }> {
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Видео больше 80 МБ. Выберите короткий ролик или фотографии.");
  const video = document.createElement("video"); video.preload = "auto"; video.muted = true; video.playsInline = true;
  const url = URL.createObjectURL(file); const pages:VideoPage[] = []; const hashes = new Set<string>(); let duplicates = 0, skipped = 0;
  try {
    const loaded = event(video, "loadeddata", signal); video.src = url; await loaded;
    const times = sampleTimes(video.duration);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth*scale)); canvas.height = Math.max(1, Math.round(video.videoHeight*scale));
    const ctx = canvas.getContext("2d", { willReadFrequently:true }); if (!ctx) throw new Error("Не удалось открыть обработку кадров.");
    for (const [index, seconds] of times.entries()) {
      if (signal.aborted) throw new Error("Выбор кадров отменён.");
      if (Math.abs(video.currentTime-seconds)>0.001) { const ready = event(video,"seeked",signal); video.currentTime=seconds; await ready; }
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const sharpness = frameSharpness(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
      const encode = (quality:number) => new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Не удалось сохранить кадр.")),"image/jpeg",quality));
      let blob = await encode(.82); if (blob.size>350000) blob=await encode(.62);
      if (blob.size>350000) { skipped++; progress(index+1,times.length); continue; }
      const digest = await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
      if (hashes.has(hash)) duplicates++; else { hashes.add(hash); pages.push({file:new File([blob],`video-page-${index+1}-at-${seconds.toFixed(1)}s.jpg`,{type:"image/jpeg"}),preview:URL.createObjectURL(blob),seconds,sharpness}); }
      progress(index+1,times.length);
    }
    if (signal.aborted) throw new Error("Выбор кадров отменён.");
    return {pages,duplicates,skipped};
  } catch (error) { pages.forEach(p=>URL.revokeObjectURL(p.preview)); throw error; }
  finally { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}
