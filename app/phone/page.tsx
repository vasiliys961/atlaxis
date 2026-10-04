"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

function PhoneUpload() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  async function send(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!code) {
      setError("Ссылка неполная. Откройте её с компьютера, где уже открыт разбор.");
      return;
    }
    setPending(true);
    setError("");
    setNote("");
    const form = new FormData();
    form.set("code", code);
    for (const file of Array.from(files)) form.append("files", file);
    const response = await fetch("/api/phone", { method: "POST", body: form });
    const body = await response.json();
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Не удалось отправить файл.");
      return;
    }
    const names = (body.documents ?? []).map((item: { fileName: string }) => item.fileName).join(", ");
    setNote(names ? `${names} приняты и стоят в очереди. На компьютере они появятся в списке, как только чтение закончится.` : "Файл отправлен.");
  }

  return (
    <article className="sheet">
      <p className="kicker">Смартфон</p>
      <h1>Отправить снимок в разбор</h1>
      <p className="lead">Снимите изображение или выберите готовый файл. Снимок с iPhone в HEIC сохраняется как JPEG и попадает в тот разбор, который открыт на компьютере. Это не отдельный кабинет.</p>
      <div className="actions plain">
        <button type="button" onClick={() => camera.current?.click()} disabled={pending}>
          {pending ? "Отправляем…" : "Снять снимок"}
        </button>
        <button className="secondary" type="button" onClick={() => gallery.current?.click()} disabled={pending}>
          Готовый PNG или JPEG
        </button>
        <input ref={camera} hidden type="file" accept="image/png,image/jpeg,image/heic,image/heif,.heic,.heif" capture="environment" onChange={(event) => void send(event.target.files)} />
        <input ref={gallery} hidden type="file" accept=".png,.jpg,.jpeg,.heic,.heif,image/png,image/jpeg,image/heic,image/heif" multiple onChange={(event) => void send(event.target.files)} />
      </div>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="quiet">{note}</p> : null}
    </article>
  );
}

export default function PhonePage() {
  return (
    <Suspense fallback={<p className="quiet">Открываем отправку…</p>}>
      <PhoneUpload />
    </Suspense>
  );
}
