"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAIN_MODELS, EYES_MODEL } from "@/lib/models";
import type { ReportBlock, ReportView } from "@/lib/types";

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

function Sources({ block }: { block: ReportBlock }) {
  if (block.sources.length === 0) return null;
  return (
    <details>
      <summary>Откуда это</summary>
      {block.sources.map((source) => (
        <blockquote key={`${source.documentId}-${source.line}-${source.excerpt}`}>
          {source.documentName}, строка {source.line}: {source.excerpt}
        </blockquote>
      ))}
    </details>
  );
}

export default function ReportPage() {
  const [report, setReport] = useState<ReportView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/documents")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Не удалось собрать разбор.");
        setReport(body.report as ReportView);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p className="quiet">Собираем разбор…</p>;

  if (report.status === "empty") {
    return (
      <article className="sheet">
        <p className="kicker">Разбор</p>
        <h1>Сначала нужны <em>документы</em></h1>
        <p className="lead">Загрузите бланк или откройте пример. Здесь будет один текст: что нашлось, как это менялось и где записи не сходятся.</p>
        <p><Link className="button" href="/">К документам</Link></p>
      </article>
    );
  }

  return (
    <article className="sheet">
      <header>
        <p className="kicker">Разбор</p>
        <h1>Что говорят <em>ваши записи</em></h1>
        <p className="lead">{report.headline}</p>
        <p className="quiet">{report.intro}</p>
      </header>

      <section className="section">
        <h2>Модели</h2>
        <p className="quiet">Снимки в JSON читает Gemini 3.8 Flash ({EYES_MODEL}). Текст по этому JSON и разбору пишут {BRAIN_MODELS.map((model) => model.label).join(" и ")}.</p>
        {report.modelsReady === false ? <p className="quiet">Ключ Пользы AI не задан. Модели не вызываются, разбор собран правилами.</p> : null}
      </section>

      {report.imageReadings && report.imageReadings.length > 0 ? (
        <section className="section">
          <h2>JSON снимков</h2>
          {report.imageReadings.map((item) => (
            <article key={item.name} className="note">
              <h3>{item.name}</h3>
              <pre>{item.json}</pre>
            </article>
          ))}
        </section>
      ) : null}

      {report.wording && report.wording.length > 0 ? (
        <section className="section">
          <h2>Простыми словами</h2>
          {report.wording.map((item) => (
            <article key={item.model} className="note">
              <h3>{item.label}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </section>
      ) : null}

      {report.status === "blocked" ? (
        <div className="notice">
          {report.blockReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      ) : null}

      <section className="section">
        <h2>Файлы</h2>
        <div className="files">
          {report.documents.map((document) => (
            <div key={document.id} className="file-chip">
              <strong>{document.name}</strong>
              <div>{document.statusLabel}. {document.note}</div>
            </div>
          ))}
        </div>
      </section>

      {report.conflicts.length > 0 ? (
        <section className="section">
          <h2>Где записи не сходятся</h2>
          {report.conflicts.map((block) => (
            <article key={block.body} className="note warn">
              <h3>{block.title}</h3>
              <Lines text={block.body} />
              <Sources block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.changes.length > 0 ? (
        <section className="section">
          <h2>Как менялось</h2>
          {report.changes.map((block) => (
            <article key={block.title + block.body} className="timeline-item">
              <h3>{block.title}</h3>
              <Lines text={block.body} />
              <Sources block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.themes.length > 0 ? (
        <section className="section">
          <h2>Что написано в документах</h2>
          {report.themes.map((block) => (
            <article key={block.title} className="note">
              <h3>{block.title}</h3>
              <Lines text={block.body} />
              <Sources block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.gaps.length > 0 ? (
        <section className="section">
          <h2>Чего в комплекте нет</h2>
          {report.gaps.map((gap) => (
            <p key={gap} className="question">{gap}</p>
          ))}
        </section>
      ) : null}

      {report.relationships.length > 0 ? (
        <section className="section">
          <h2>Что видно вместе</h2>
          {report.relationships.map((block) => (
            <article key={block.body} className="note">
              <h3>{block.title}</h3>
              <Lines text={block.body} />
              <Sources block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.cannotSay.length > 0 ? (
        <section className="section">
          <h2>Что сказать нельзя</h2>
          {report.cannotSay.map((line) => (
            <p key={line} className="question">{line}</p>
          ))}
        </section>
      ) : null}

      {report.questions.length > 0 ? (
        <section className="section">
          <h2>Что взять на приём</h2>
          {report.questions.map((question) => (
            <p key={question} className="question">{question}</p>
          ))}
        </section>
      ) : null}

      <section className="section">
        <h2>Какие рекомендации смотрели</h2>
        <p>{report.guidelineNote}</p>
      </section>

      <section className="footer-note">
        {report.limits.map((limit) => (
          <p key={limit} className="quiet">{limit}</p>
        ))}
        <p><Link href="/review">Форма проверки качества</Link></p>
      </section>
    </article>
  );
}
