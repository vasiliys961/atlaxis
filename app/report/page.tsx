"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { discussFinding } from "@/lib/discuss";
import { targetMark } from "@/lib/guidelines";
import { EYES_MODEL, SONAR_MODEL } from "@/lib/models";
import { writerFor } from "@/lib/router";
import type { ReportBlock, ReportView, TimelineEvent } from "@/lib/types";

function writtenWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(date);
}

function plain(text: string): string {
  return text.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim();
}

function SonarNote({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <article className="note">
      <h3>Что нашёл Sonar</h3>
      <p>{plain(text)}</p>
      <p className="quiet">Это цитата для пояснения уже записанных анализов, не диагноз и не лечение.</p>
    </article>
  );
}

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line) => (
        <p key={line}>{line}</p>
      ))}
    </>
  );
}

function Quote({ source }: { source: ReportBlock["sources"][number] }) {
  return (
    <blockquote>
      {source.documentName}, строка {source.line}: {source.excerpt}
    </blockquote>
  );
}

function Discuss({ text }: { text: string }) {
  const finding = text.replace(/\s+/g, " ").trim();
  if (!finding) return null;
  return (
    <button type="button" className="discuss" onClick={() => discussFinding(finding)}>
      Профессору
    </button>
  );
}

function Finding({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="finding">
      <div className="finding-body">{children}</div>
      <Discuss text={text} />
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const when = event.date ?? "Дата не указана";
  const text = `${when}. ${event.text}`;
  return (
    <Finding text={text}>
      <details className="fact">
        <summary>{text}</summary>
        <Quote source={event.source} />
      </details>
    </Finding>
  );
}

function Statements({ block }: { block: ReportBlock }) {
  const lines = block.body.split("\n").map((line) => line.trim()).filter(Boolean);
  const paired = lines.length > 0 && lines.length === block.sources.length;
  const oneStatement = lines.length === 1 && block.sources.length > 0;
  return (
    <>
      {block.lead ? <p className="quiet">{block.lead}</p> : null}
      {paired ? lines.map((line, index) => {
        const source = block.sources[index];
        if (!source) return null;
        return (
          <Finding key={`${source.documentId}-${source.line}-${index}`} text={line}>
            <details className="fact">
              <summary>{line}</summary>
              <Quote source={source} />
            </details>
          </Finding>
        );
      }) : oneStatement ? (
        <Finding text={lines[0] ?? ""}>
          <details className="fact">
            <summary>{lines[0]}</summary>
            {block.sources.map((source) => (
              <Quote key={`${source.documentId}-${source.line}-${source.excerpt}`} source={source} />
            ))}
          </details>
        </Finding>
      ) : (
        <Finding text={block.body}>
          <Lines text={block.body} />
          {block.sources.length > 0 ? (
            <details>
              <summary>Откуда это</summary>
              {block.sources.map((source) => (
                <Quote key={`${source.documentId}-${source.line}-${source.excerpt}`} source={source} />
              ))}
            </details>
          ) : null}
        </Finding>
      )}
    </>
  );
}

export default function ReportPage() {
  const [report, setReport] = useState<ReportView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function pull() {
      try {
        const response = await fetch("/api/documents");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Не удалось собрать разбор.");
        if (stop) return;
        if (body.report) setReport(body.report as ReportView);
        if (body.pending || body.refreshing) timer = window.setTimeout(() => void pull(), 2500);
      } catch (reason) {
        if (!stop) setError(reason instanceof Error ? reason.message : "Не удалось собрать разбор.");
      }
    }
    void pull();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
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
        <p className="quiet">Снимки в JSON читает Gemini 3.8 Flash ({EYES_MODEL}). Спокойную тему пересказывает Sonnet 5.5, тему со спорной записью — Opus 5.5. Актуальные рекомендации по уже загруженным анализам ищет Sonar ({SONAR_MODEL}).</p>
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
              <Statements block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.timeline && report.timeline.length > 0 ? (
        <section className="section">
          <h2>По времени</h2>
          <p className="quiet">Записи стоят по дате документа. Строка без даты — в конце. Связи между ними здесь не называются.</p>
          {report.timeline.map((event) => (
            <TimelineRow key={`${event.source.documentId}-${event.source.line}-${event.kind}-${event.text}`} event={event} />
          ))}
        </section>
      ) : null}

      {report.changes.length > 0 ? (
        <section className="section">
          <h2>Как менялось</h2>
          {report.changes.map((block) => (
            <article key={block.title + block.body} className="timeline-item">
              <h3>{block.title}</h3>
              <Statements block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.themes.length > 0 ? (
        <section className="section">
          <h2>Что написано в документах</h2>
          {report.themes.some((block) => block.body.trim() && !block.notes?.some((note) => note.model === writerFor(block).id)) ? (
            <p className="quiet">Пояснения по темам ещё пишутся.</p>
          ) : null}
          {report.themes.map((block) => (
            <article key={block.title} className="note">
              <h3>{block.title}</h3>
              <Statements block={block} />
              {block.notes?.filter((note) => note.model === writerFor(block).id).map((note) => (
                <p key={note.model} className="quiet">{note.label}. {plain(note.text)}</p>
              ))}
            </article>
          ))}
        </section>
      ) : null}

      {report.gaps.length > 0 ? (
        <section className="section">
          <h2>Чего в комплекте нет</h2>
          {report.gaps.map((gap) => (
            <Finding key={gap} text={gap}>
              <p className="question">{gap}</p>
            </Finding>
          ))}
        </section>
      ) : null}

      {report.relationships.length > 0 ? (
        <section className="section">
          <h2>Что видно вместе</h2>
          {report.relationships.map((block) => (
            <article key={block.body} className="note">
              <h3>{block.title}</h3>
              <Statements block={block} />
            </article>
          ))}
        </section>
      ) : null}

      {report.cannotSay.length > 0 ? (
        <section className="section">
          <h2>Что сказать нельзя</h2>
          {report.cannotSay.map((line) => (
            <Finding key={line} text={line}>
              <p className="question">{line}</p>
            </Finding>
          ))}
        </section>
      ) : null}

      {report.questions.length > 0 ? (
        <section className="section">
          <h2>Что взять на приём</h2>
          {report.questions.map((question) => (
            <Finding key={question} text={question}>
              <p className="question">{question}</p>
            </Finding>
          ))}
        </section>
      ) : null}

      <section className="section">
        <h2>Какие рекомендации смотрели</h2>
        <p>{report.guidelineNote}</p>
        {report.region === "RU" ? <SonarNote text={report.guidelineSearch} /> : null}
        {report.catalog?.map((item) => {
          const label = item.origin === "offered"
            ? `${item.standing === "current" ? "Предложена" : "Предложена и актуальной не считается"}: ${item.place}`
            : item.standing === "current"
              ? "Рабочая запись каталога"
              : "В каталоге сохранена и актуальной не считается";
          return (
            <p key={`${item.place}-${item.organization}-${item.version}`} className="quiet">
              {label}. {item.organization}. {item.title}. Версия {item.version}, {item.publicationDate}. {targetMark(item)}{item.url ? " " : ""}
              {item.url ? <a href={item.url}>Источник</a> : null}
            </p>
          );
        })}
        {report.region === "RU" ? null : <SonarNote text={report.guidelineSearch} />}
      </section>

      <section className="footer-note">
        <p className="quiet">Этот разбор собран {writtenWhen(report.generatedAt)}. Версия обработки {report.pipelineVersion}.</p>
        {report.limits.map((limit) => (
          <p key={limit} className="quiet">{limit}</p>
        ))}
      </section>
    </article>
  );
}
