"use client";

import { useEffect, useState } from "react";
import type { QualityCheck } from "@/lib/checks";

const TYPES = [
  ["outdated_guideline", "Устаревшая рекомендация"],
  ["dose", "Доза"],
  ["target", "Целевой показатель"],
  ["document_error", "Ошибка документа"],
  ["missed_question", "Пропущенный вопрос"],
  ["missed_link", "Пропущенная связь"],
  ["unclear", "Непонятная формулировка"],
  ["out_of_scope", "Выход за справочную роль"],
  ["other", "Другое"],
] as const;

const SEVERITY = [
  ["blocker", "Блокер выдачи"],
  ["fix", "Нужно исправить"],
  ["language", "Замечание к языку"],
] as const;

export default function ReviewPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [checks, setChecks] = useState<QualityCheck[]>([]);

  useEffect(() => {
    let stop = false;
    void fetch("/api/reviews")
      .then((response) => response.json())
      .then((body: { checks?: QualityCheck[] }) => {
        if (!stop && body.checks) setChecks(body.checks);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  async function submit(formData: FormData) {
    setError("");
    setMessage("");
    const payload = Object.fromEntries(formData.entries());
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Не удалось сохранить.");
      return;
    }
    setMessage("Находка сохранена. Общая оценка без цитаты не принимается.");
  }

  return (
    <article className="sheet">
      <p className="kicker">Проверка качества</p>
      <h1>Разбор одной находки</h1>
      <p className="lead">Это не кабинет врача и не доступ к чужому аккаунту. Нужны цитата ответа, почему это неверно и как должно звучать в справочных границах.</p>
      {checks.length > 0 ? (
        <section className="section">
          <h2>Отдельные проверки</h2>
          <p className="quiet">Каждая строка считается своим правилом. Общей оценки здесь нет.</p>
          {checks.map((item) => (
            <p key={item.label}>{item.label}: {item.text}</p>
          ))}
        </section>
      ) : null}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
        <label className="quiet">Тип
          <select name="type" defaultValue="document_error">{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <label className="quiet">Цитата ответа
          <textarea name="quote" required minLength={8} rows={3} />
        </label>
        <label className="quiet">Почему это не так
          <textarea name="why" required minLength={8} rows={3} />
        </label>
        <label className="quiet">Как должно быть
          <textarea name="shouldBe" required minLength={8} rows={3} />
        </label>
        <label className="quiet">Организация
          <input name="organization" required minLength={2} />
        </label>
        <label className="quiet">Название рекомендации
          <input name="guidelineTitle" required minLength={2} />
        </label>
        <label className="quiet">Версия
          <input name="version" required />
        </label>
        <label className="quiet">Год
          <input name="year" required pattern="\d{4}" />
        </label>
        <label className="quiet">Критичность
          <select name="severity" defaultValue="fix">{SEVERITY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
        <button type="submit">Сохранить находку</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="quiet">{message}</p> : null}
    </article>
  );
}
