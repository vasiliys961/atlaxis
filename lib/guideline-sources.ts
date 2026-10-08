import type { Region } from "./types";
export type GuidelineSource = { url: string; region: Region; status: "retrieved" | "unavailable"; excerpt: string; latestEditionVerified: false };
const hosts: Record<Region, string[]> = { RU: ["cr.minzdrav.gov.ru", "scardio.ru", "raaci.ru", "rheumatolog.ru"], US: ["acc.org", "heart.org", "ahajournals.org", "thoracic.org", "diabetesjournals.org", "cdc.gov", "nih.gov", "niddk.nih.gov"], EU: ["escardio.org", "ersnet.org", "erj.ersjournals.com", "eular.org", "easd.org"] };
export function guidelineRegion(raw: string): Region | null {
  try { const u = new URL(raw); if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    for (const [region, list] of Object.entries(hosts)) if (list.some(host => u.hostname === host || u.hostname === `www.${host}`)) return region as Region;
  } catch {} return null;
}
export async function retrieveGuidelineSources(text: string): Promise<GuidelineSource[]> {
  const urls = [...new Set((text.match(/https:\/\/[^\s<>"\])]+/g) ?? []).map(u => u.replace(/[.,;]+$/, "")))].filter(u => guidelineRegion(u));
  // Bounded, exact host allowlist; never follow a redirect to an arbitrary host.
  return Promise.all(urls.slice(0, 3).map(async url => {
    const base: GuidelineSource = { url, region: guidelineRegion(url)!, status: "unavailable", excerpt: "", latestEditionVerified: false };
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (!response.ok || !/text\/html|text\/plain/i.test(response.headers.get("content-type") ?? "")) return base;
      const reader = response.body?.getReader(); if (!reader) return base;
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 256000) break; chunks.push(part.value); } }
      finally { await reader.cancel(); }
      const html = Buffer.concat(chunks).toString("utf8");
      const excerpt = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
      return excerpt ? { ...base, status: "retrieved" as const, excerpt } : base;
    } catch { return base; }
  }));
}
