"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { discussFinding, discussSheet } from "@/lib/discuss";
import { targetMark } from "@/lib/guidelines";
import { patientFileNote } from "@/lib/patient-note";
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

function SearchNote({ text }: { text?: string }) {
  if (!text) return null;
  const marker = "\n\nПроверка доступа к первичным страницам";
  const body = text.split(marker)[0];
  let sources: {url:string;region:string;status:string}[] = [];
  try { const data = text.split(marker)[1]?.split("\n")[1]; if (data) sources = JSON.parse(data); } catch {}
  return <article className="note">
    <h3>Справочная основа: клинические рекомендации</h3>
    <p>{plain(body)}</p>
    {sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.region}: первичная страница</a> — {source.status === "retrieved" ? "получен фрагмент текста" : "текст страницы не получен"}.</p>)}
    <p className="quiet">Проверяется доступ максимум к трём первичным страницам. Доступ не подтверждает актуальность редакции, весь документ или применимость к человеку. Поисковые сведения требуют проверки. Научная статья не заменяет клиническую рекомендацию.</p>
  </article>;
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
  const [dropping, setDropping] = useState<string | null>(null);

  async function removeDocument(id: string) {
    setDropping(id);
    setError("");
    const response = await fetch("/api/documents", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) {
      setDropping(null);
      setError("Не удалось удалить файл. Он остался в списке.");
      return;
    }
    window.location.assign("/");
  }

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
        else if (!body.pending && !body.refreshing) setReport({ status: "empty" } as ReportView);
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
  if (!report) {
    return (
      <article className="sheet">
        <p className="quiet">Собираем разбор…</p>
      </article>
    );
  }

  if (report.status === "empty") {
    return (
      <article className="sheet">
        <p className="kicker">Разбор</p>
        <h1>Сначала нужны <em>документы</em></h1>
        <p className="lead">Загрузите бланк. Здесь будет один текст: что нашлось, как это менялось и где записи не сходятся.</p>
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
        {report.status === "ready" ? (
          <p className="sheet-ask">
            <button type="button" className="secondary" onClick={() => discussSheet()}>Весь разбор профессору</button>
            <span className="quiet">Кнопка у строки отправляет одну находку. «Весь разбор профессору» отправляет лист целиком. Лишний файл удаляется своей кнопкой, остальные остаются.</span>
          </p>
        ) : null}
      </header>

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
              <div>{document.statusLabel}. {patientFileNote(document.note)}</div>
              <button className="danger file-drop" type="button" onClick={() => void removeDocument(document.id)} disabled={dropping !== null}>
                {dropping === document.id ? "Удаляем…" : "Удалить"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Комплексная клиническая интерпретация</h2>
        <p className="quiet">Основная система рекомендаций: {{ RU: "Российская Федерация", US: "США", EU: "Европа" }[report.region]}. Источники других регионов используются для отдельного сопоставления.</p>
        {!report.clinicalSynthesis ? (
          <p className="quiet">{report.modelsReady ? "Общий разбор всех документов ещё готовится." : "Для комплексной интерпретации нужен подключённый медицинский ИИ. Записи из документов доступны ниже."}</p>
        ) : (
          <>
            <p className="quiet">{report.clinicalSynthesis.version === "3" ? report.clinicalSynthesis.message : "Предыдущая интерпретация скрыта: требуется обновление в справочном формате."}</p>
            {report.clinicalSynthesis.version === "3" && report.clinicalSynthesis.status === "ready" ? (
              <>
                {report.clinicalSynthesis.overview ? <article className="note"><h3>{report.clinicalSynthesis.overview.title}</h3><Statements block={{ title: report.clinicalSynthesis.overview.title, body: report.clinicalSynthesis.overview.text, sources: report.clinicalSynthesis.overview.sources }} /></article> : null}
                {report.clinicalSynthesis.documentedRecords.length ? <h3>Что записано в документах</h3> : null}
                {report.clinicalSynthesis.documentedRecords.map((item, i) => <article className="note" key={`record-${i}`}><h4>{item.title}</h4><Statements block={{title:item.title,body:item.text,lead:"Запись автора документа; её актуальность оценивает врач.",sources:item.sources}} /></article>)}
                {report.clinicalSynthesis.explanations.length ? <h3>Как понимать изменения</h3> : null}
                {report.clinicalSynthesis.explanations.map((item, i) => <article className="note" key={`explanation-${i}`}><h4>{item.title}</h4><Statements block={{title:item.title,body:item.text,sources:item.sources}} />{item.missing.map((text, n) => <p className="quiet" key={n}>Для понимания: {text}</p>)}</article>)}
                {report.clinicalSynthesis.discussionPoints.length ? <h3>Что обсудить с врачом</h3> : null}
                {report.clinicalSynthesis.discussionPoints.map((item, i) => <article className="note" key={`question-${i}`}><h4>{item.title}</h4><Statements block={{title:item.title,body:item.text,sources:item.sources}} /></article>)}
                {report.clinicalSynthesis.practicalAdvice.length > 0 ? <h3>Практические аспекты</h3> : null}
                {report.clinicalSynthesis.practicalAdvice.map((item, index) => <article className="note" key={`advice-${index}`}><h4>{item.title}</h4><Statements block={{ title: item.title, body: item.text, sources: item.sources }} /></article>)}
                {report.clinicalSynthesis.missingContext.length > 0 ? <details><summary>Каких сведений не хватает для общего вывода</summary>{report.clinicalSynthesis.missingContext.map((text, index) => <p key={index}>{text}</p>)}</details> : null}
              </>
            ) : null}
          </>
        )}
      </section>

      {report.instrumentStudies?.length ? <section className="section">
        <h2>ЭКГ и спирометрия в комплекте</h2>
        <p className="quiet">Записи учитываются в общем разборе. Подробные параметры доступны для сверки с оригиналом.</p>
        {report.instrumentStudies.map(study => <article className="note" key={`${study.documentId}-${study.kind}`}>
          <h3>{study.kind === "ecg" ? "ЭКГ" : "Спирометрия"}: {study.documentName}</h3>
          <details><summary>Показать напечатанные параметры и источники</summary>
          {study.parameters.map((parameter, index) => <div key={index}>
            <p>{parameter.name}: {parameter.status === "printed" ? `${parameter.valueText} ${parameter.unit}` : "значение или столбец не определены однозначно"}.</p>
            <p className="quiet">{parameter.context}. Строка {parameter.source.line}: {parameter.source.excerpt}</p>
          </div>)}
          </details>
          {study.recordedConclusions.map(source => <p key={source.line}>Запись в документе, не вывод сервиса: {source.excerpt}</p>)}
          {study.limitations.map((text, i) => <p className="quiet" key={i}>{text}</p>)}
        </article>)}
      </section> : null}

      {report.imagingStudies?.length ? <section className="section">
        <h2>Что обработано в изображениях</h2>
        {report.imagingStudies.map(study => <article className="note" key={study.documentId}>
          <h3>{study.documentName}</h3>
          <p>{study.status === "ready" ? "Визуальная модель обработала кадры." : "Визуальная интерпретация недоступна."} {study.totalFrames > 0 ? `Просмотрено ${study.analyzedFrames.length} из ${study.totalFrames} кадров файла.` : "Кадры файла не удалось прочитать."}</p>
          <p className="quiet">{study.coverage === "sampled" ? "Это выборка, а не полный анализ исследования." : "Обработаны кадры этого файла; они могут быть частью более крупной серии."}</p>
          {study.limitations.map((line, index) => <p className="quiet" key={index}>{line}</p>)}
        </article>)}
      </section> : null}

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
                <p key={note.model} className="quiet">{plain(note.text)}</p>
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
        {report.region === "RU" ? <SearchNote text={report.guidelineSearch} /> : null}
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
        {report.region === "RU" ? null : <SearchNote text={report.guidelineSearch} />}
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
