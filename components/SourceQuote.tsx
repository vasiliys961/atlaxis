"use client";

import { useState } from "react";
import type { SourceRef } from "@/lib/types";

export function SourceQuote({ source }: { source: SourceRef }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const visual = source.excerpt.startsWith("Предварительное визуальное наблюдение ИИ:");
  async function show() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (lines) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(source.documentId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || typeof body.sourceText !== "string") throw new Error("Документ недоступен. Возможно, он удалён.");
      setLines(body.sourceText.split(/\r?\n/));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть источник."); }
    finally { setLoading(false); }
  }
  return <blockquote>
    <p>{source.documentName}, {visual ? "наблюдение модели" : `строка ${source.line}`}: {source.excerpt}</p>
    {visual ? <p className="quiet">Это предварительное наблюдение ИИ, а не цитата из заключения врача.</p> : <>
      <button type="button" className="secondary" onClick={() => void show()} aria-expanded={open}>{open ? "Скрыть контекст" : "Открыть фрагмент документа"}</button>
      {open ? <div aria-live="polite">
        {loading ? <p>Открываем источник…</p> : null}
        {error ? <p className="error">{error}</p> : null}
        {lines ? <>
          <p className="quiet">Распознанный и обезличенный текст. Номер строки относится к извлечённому тексту; страница оригинала не установлена.</p>
          {lines[source.line - 1]?.trim() !== source.excerpt.trim() ? <p className="notice">Цитата отличается от текущей строки. Сверьте источник; сохранённый разбор мог устареть.</p> : null}
          {lines.slice(Math.max(0, source.line - 4), source.line + 3).map((line, index) => {
            const number = Math.max(0, source.line - 4) + index + 1;
            return <p key={number}>{number === source.line ? <mark>{number}: {line}</mark> : `${number}: ${line}`}</p>;
          })}
        </> : null}
      </div> : null}
    </>}
  </blockquote>;
}
