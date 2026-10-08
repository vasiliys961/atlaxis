"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { patientFileNote } from "@/lib/patient-note";
import type { MedicalDocument, Region, ReportView } from "@/lib/types";

type ListedDocument = Omit<MedicalDocument, "anonymizedText"> & {
  factCount: number;
  issueCount: number;
};

const REGIONS: { id: Region; label: string; hint: string }[] = [
  { id: "RU", label: "Россия", hint: "По каждой проблеме ищутся только последние рекомендации: российская и международная. Более ранняя редакция не показывается." },
  { id: "EU", label: "Европа", hint: "В каталоге только последняя редакция ESC/EAS 2025. Более ранняя не показывается. Цель из записи показана с пометкой группы и не становится личной." },
  { id: "US", label: "США", hint: "В каталоге только последняя редакция ACC/AHA 2026. Редакция 2018 не показывается." },
];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<ListedDocument[]>([]);
  const [report, setReport] = useState<ReportView | null>(null);
  const [region, setRegion] = useState<Region>("RU");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<"upload" | "delete" | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneQr, setPhoneQr] = useState("");
  const [over, setOver] = useState(false);
  const readyImage = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch("/api/documents");
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Не удалось открыть документы.");
      return;
    }
    setDocuments(body.documents ?? []);
    setReport(body.report ?? null);
    setRegion(body.region ?? "RU");
    setWaiting(Boolean(body.pending));
  }

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!phoneOpen) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [phoneOpen]);

  useEffect(() => {
    if (!phoneCode) {
      setPhoneQr("");
      return;
    }
    let cancel = false;
    void import("qrcode").then((QR) =>
      QR.toDataURL(`${window.location.origin}/phone?code=${phoneCode}`, { margin: 1, width: 280 }),
    ).then((url) => {
      if (!cancel) setPhoneQr(url);
    });
    return () => {
      cancel = true;
    };
  }, [phoneCode]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPending("upload");
    setError("");
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    const response = await fetch("/api/documents", { method: "POST", body: form });
    const body = await response.json();
    setPending(null);
    if (!response.ok) {
      setError(body.error ?? "Не удалось принять файл.");
      return;
    }
    await load();
  }

  async function chooseRegion(next: Region) {
    setRegion(next);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ region: next }),
    });
    if (!response.ok) {
      setError("Не удалось сохранить страну рекомендаций.");
      return;
    }
    await load();
  }

  async function openPhone() {
    setPhoneOpen(true);
    setPhoneQr("");
    setError("");
    const response = await fetch("/api/phone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Не удалось открыть отправку с телефона.");
      return;
    }
    setPhoneCode(body.code ?? "");
  }

  async function removeDocument(id: string) {
    setDropping(id);
    setError("");
    const response = await fetch("/api/documents", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDropping(null);
    if (!response.ok) {
      setError("Не удалось удалить файл. Он остался в списке.");
      return;
    }
    await load();
  }

  async function removeAll() {
    setPending("delete");
    setError("");
    const response = await fetch("/api/privacy/delete", { method: "POST" });
    setPending(null);
    setConfirmDelete(false);
    if (!response.ok) {
      setError("Не удалось удалить данные.");
      return;
    }
    setDocuments([]);
    setReport(null);
  }

  const hint = REGIONS.find((item) => item.id === region)?.hint ?? "";
  const ready = documents.some((document) => document.status === "ready");

  return (
    <>
      <section className="hero">
        <div>
          <p className="kicker">Личный AI-ассистент по здоровью</p>
          <h1>Все ваши анализы — <em>в одну картину</em></h1>
          <p className="lead">Загрузите бланки, выписки и снимки. ATLAXIS сопоставит медицинские данные, объяснит изменения и возможные причины, покажет диагностические версии и направления лечения для обсуждения с врачом.</p>
          <div className="cta">
            <a className="button" href="#upload">Загрузить документы</a>
          </div>
        </div>
        <div className="meds" aria-hidden="true">
          <div className="med m2"><svg><use href="#d-steth" /></svg><span className="lbl">Пульс</span></div>
          <div className="med m4"><svg><use href="#d-oxi" /></svg><span className="lbl">Кислород</span></div>
          <div className="med m1"><svg><use href="#d-micro" /></svg><span className="lbl">Анализы</span></div>
          <div className="med m3"><svg><use href="#d-therm" /></svg><span className="lbl">Температура</span></div>
          <div className="med m5"><svg><use href="#d-gauge" /></svg><span className="lbl">Давление</span></div>
          <div className="hello"><div><b>Профессор — в окне справа.</b> Он помогает понять изменения и обсудить проверенные диагностические версии и направления лечения.</div></div>
        </div>
      </section>

      <div className="upload" id="upload">
        <div
          className={over ? "drop over" : "drop"}
          onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
          onDragOver={(event) => { event.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); void upload(event.dataTransfer.files); }}
        >
          <div>
            <h2>{pending === "upload" ? "Принимаем файлы…" : waiting ? (documents.some((item) => item.statusLabel === "Разбирается") ? "Файлы разбираются" : "Файлы проверяются") : "Перетащите сюда или выберите файлы"}</h2>
            <p className="quiet">Текст, PDF, Word, снимок. Снимок с iPhone сохраняется как JPEG. Персональные данные в тексте скрываются до разбора.</p>
          </div>
          <label className="button">
            {pending === "upload" ? "Подождите" : "Выбрать файлы"}
            <input hidden type="file" multiple accept=".txt,.csv,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,.heic,.heif,.dcm" onChange={(event) => void upload(event.target.files)} />
          </label>
        </div>
        {documents.length > 0 ? (
          <ul className="doc-list">
            {documents.map((document) => (
              <li key={document.id}>
                <span className="name">{document.fileName}</span>
                <span className="quiet">{document.studyDate ? `${document.studyDate}. ` : ""}{document.factCount > 0 ? `${document.factCount} изм.` : patientFileNote(document.note)}</span>
                <span className={document.status === "ready" ? "pill" : "pill wait"}>{document.statusLabel}</span>
                <button className="danger file-drop" type="button" onClick={() => void removeDocument(document.id)} disabled={dropping !== null || pending !== null}>
                  {dropping === document.id ? "Удаляем…" : "Удалить"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="chips">
          <button className="chip" type="button" onClick={() => setGuideOpen(true)}>Инструкция</button>
          <button className="chip" type="button" onClick={() => readyImage.current?.click()} disabled={pending !== null}>Готовый PNG или JPEG</button>
          <input ref={readyImage} hidden type="file" accept=".png,.jpg,.jpeg,.heic,.heif,image/png,image/jpeg,image/heic,image/heif" multiple onChange={(event) => void upload(event.target.files)} />
          <button className="chip" type="button" onClick={() => void openPhone()} disabled={pending !== null}>Со смартфона</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}

      {guideOpen ? (
        <div className="modal" role="presentation" onClick={() => setGuideOpen(false)}>
          <div className="window" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">Для пациента</p>
            <h2 id="guide-title">Как пользоваться</h2>
            <div className="quiet stack">
              <p>Загрузите бланки и выписки текстом, PDF или Word (.docx). Из них читаются показатели, даты и дозы, которые написаны в файле.</p>
              <p>Готовый снимок — кнопка «PNG или JPEG»: файл, который уже лежит на компьютере. Снимок с iPhone в HEIC сохраняется как JPEG.</p>
              <p>Со смартфона — кнопка показывает QR-код. Наведите камеру телефона: можно снять снимок или выбрать готовый файл. HEIC с iPhone сохраняется как JPEG и попадает в этот же разбор.</p>
              <p>Снимок читается в показатели, которые совпали со словарём. Если текст на изображении не принят, числа с него в разбор не входят.</p>
              <p>Разбор объединяет записи, динамику, возможные объяснения и практические аспекты лечения. Диагнозы из выписки и новые гипотезы обозначены отдельно.</p>
              <p>У каждой находки есть кнопка «Профессору»: она отправляет одну строку. «Весь разбор профессору» в начале листа отправляет комплект целиком. Профессор объясняет проверенную комплексную интерпретацию и помогает подготовить вопросы врачу.</p>
              <p>У каждого файла своя кнопка «Удалить». Остальные файлы остаются. «Удалить мои данные» стирает весь комплект и спрашивает ещё раз.</p>
            </div>
            <div className="actions plain">
              <button type="button" onClick={() => setGuideOpen(false)}>Понятно</button>
            </div>
          </div>
        </div>
      ) : null}

      {phoneOpen ? (
        <div className="modal" role="presentation" onClick={() => setPhoneOpen(false)}>
          <div className="window" role="dialog" aria-modal="true" aria-labelledby="phone-title" onClick={(event) => event.stopPropagation()}>
            <p className="kicker">Смартфон</p>
            <h2 id="phone-title">Отправить снимок с телефона</h2>
            <p className="quiet">Наведите камеру смартфона на код. Снимок появится в этом списке. Файл с iPhone в HEIC сохраняется как JPEG. Код действует два часа и ведёт только в этот разбор.</p>
            {phoneQr ? <img className="qr" src={phoneQr} alt="QR-код для отправки снимка" /> : <p className="quiet">Готовим код…</p>}
            <div className="actions plain">
              <button className="secondary" type="button" onClick={() => setPhoneOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {ready && report && report.status !== "empty" ? (
        <Link className="bridge" href="/report">
          <span>Разбор собран</span>
          <strong>{report.headline}</strong>
          <span className="quiet">Открыть текст для чтения</span>
        </Link>
      ) : null}

      <div className="steps">
        <article className="card step"><span className="n">01</span><b>Читает вместе</b><span className="quiet">Бланки, выписки и снимки сводятся в одну картину.</span></article>
        <article className="card step"><span className="n">02</span><b>Находит расхождения</b><span className="quiet">Показывает динамику по датам и места, где записи не сходятся.</span></article>
        <article className="card step"><span className="n">03</span><b>Не заменяет врача</b><span className="quiet">Гипотезы и советы помогают обсудить состояние с врачом; персональные назначения остаются за ним.</span></article>
      </div>

      <div className="grid2">
        <aside className="card">
          <h3>Страна рекомендаций</h3>
          <div className="choice-list">
            {REGIONS.map((item) => (
              <button key={item.id} type="button" className={item.id === region ? "choice selected" : "choice"} onClick={() => void chooseRegion(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="quiet hint">{hint}</p>
        </aside>
        <section className="card">
          <p className="lead">Ваши данные — только ваши. Персональные данные скрываются до разбора, а удалить всё можно одним нажатием.</p>
          <div className="actions">
            {confirmDelete ? (
              <>
                <button className="danger" type="button" onClick={() => void removeAll()} disabled={pending !== null}>{pending === "delete" ? "Удаляем…" : "Да, удалить всё"}</button>
                <button className="secondary" type="button" onClick={() => setConfirmDelete(false)} disabled={pending !== null}>Оставить</button>
              </>
            ) : (
              <button className="danger" type="button" onClick={() => setConfirmDelete(true)} disabled={documents.length === 0 || pending !== null}>Удалить мои данные</button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
