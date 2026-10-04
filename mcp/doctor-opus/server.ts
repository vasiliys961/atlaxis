import { askDoctorOpus, doctorOpusStatus } from "../../lib/doctor-opus";
import { doctorOpusImaging } from "../../lib/imaging-provider";

type Json = Record<string, unknown>;

const tools = [
  {
    name: "doctor_opus_status",
    description: "Показывает, подключён ли удалённый MCP Doctor Opus. Сейчас канал только локальный.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask_doctor_opus",
    description: "Готовит вопрос к Doctor Opus. Пока MCP Doctor Opus не опубликован, вопрос наружу не отправляется.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "Вопрос о снимке или находке. Не диагноз и не назначение." } },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_imaging_request",
    description: "Готовит задание на чтение снимка для Doctor Opus. Файл не передаётся, оплаты нет.",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string" },
        note: { type: "string" },
      },
      required: ["fileName"],
      additionalProperties: false,
    },
  },
];

function result(id: unknown, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function toolText(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

async function handle(message: Json): Promise<Json | null> {
  const id = message.id;
  const method = String(message.method ?? "");
  const params = (message.params ?? {}) as Json;
  if (method === "initialize") {
    return result(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "atlaxis-doctor-opus", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") return result(id, { tools });
  if (method === "tools/call") {
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Json;
    if (name === "doctor_opus_status") return result(id, toolText(doctorOpusStatus()));
    if (name === "ask_doctor_opus") return result(id, toolText(askDoctorOpus(String(args.question ?? ""))));
    if (name === "submit_imaging_request") {
      return result(id, toolText(await doctorOpusImaging.read({
        fileName: String(args.fileName ?? ""),
        note: String(args.note ?? ""),
      })));
    }
    return { jsonrpc: "2.0", id, error: { code: -32602, message: "Неизвестный инструмент." } };
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Метод не поддерживается." } };
}

let buffer = Buffer.alloc(0);

function takeMessages(chunk: Buffer): Json[] {
  buffer = Buffer.concat([buffer, chunk]);
  const messages: Json[] = [];
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match?.[1]) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    messages.push(JSON.parse(body) as Json);
  }
  return messages;
}

function write(message: Json) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

process.stdin.on("data", (chunk: Buffer) => {
  void (async () => {
    for (const message of takeMessages(chunk)) {
      const response = await handle(message);
      if (response) write(response);
    }
  })();
});
