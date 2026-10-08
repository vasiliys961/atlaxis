import type { StructuredTextItem } from "unpdf";

export function layoutPageText(items: Pick<StructuredTextItem, "str" | "x" | "y">[]): string {
  const rows: {y:number;items:typeof items}[] = [];
  for (const item of [...items].filter(item => item.str.trim()).sort((a,b)=>b.y-a.y || a.x-b.x)) {
    // Join only items sharing a visual baseline; never zip unrelated columns by order.
    const row = rows.find(row => Math.abs(row.y-item.y) <= 2);
    if (row) row.items.push(item); else rows.push({y:item.y,items:[item]});
  }
  return rows.map(row => row.items.sort((a,b)=>a.x-b.x).map(item=>item.str.trim()).join(" ")).join("\n");
}

export async function extractPdfText(bytes: Buffer): Promise<string> {
  const { extractTextItems } = await import("unpdf");
  const extracted = await extractTextItems(new Uint8Array(bytes));
  return extracted.items.map((items,index)=>`Страница PDF: ${index+1}\n${layoutPageText(items)}`).join("\n\n");
}
