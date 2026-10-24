import { request } from "node:https";

/** Transport reused from cips-procurement-translator; API key remains server-only. */
export async function openaiSdpCall(form: FormData, signal: AbortSignal): Promise<{ status: number; body: string }> {
  const encoded = new Request("https://api.openai.com/v1/realtime/calls", { method: "POST", body: form });
  const bytes = Buffer.from(await encoded.arrayBuffer());
  return new Promise((resolve, reject) => {
    const call = request("https://api.openai.com/v1/realtime/calls", {
      method: "POST", signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": encoded.headers.get("content-type")!,
        "Content-Length": bytes.length,
      },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1024 * 1024) { call.destroy(new Error("oversized_answer")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    call.on("error", reject);
    call.setTimeout(30_000, () => call.destroy(new Error("connection_timeout")));
    call.end(bytes);
  });
}
