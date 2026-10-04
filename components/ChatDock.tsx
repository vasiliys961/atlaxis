"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChatTurn } from "@/lib/types";

function readable(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\|[-:| ]+\|$/gm, "")
    .trim();
}

export function ChatDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/chat")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Чат не открылся.");
        setMessages(body.messages as ChatTurn[]);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [open]);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages, pending]);

  if (pathname.startsWith("/phone")) return null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    setPending(true);
    setError("");
    setDraft("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось ответить.");
      setMessages(body.messages as ChatTurn[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось ответить.");
      setDraft(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="chat-launcher" type="button" onClick={() => setOpen(true)}>
        Спросить по анализам
      </button>
      {open ? (
        <div className="chat-layer" role="presentation">
          <section className="chat-window" role="dialog" aria-labelledby="chat-title">
            <header>
              <p className="kicker">Советы по результатам</p>
              <h2 id="chat-title">Спросите по вашим анализам</h2>
              <p>Разъяснение полученных сведений. Без диагноза и без лечения.</p>
              <button className="secondary" type="button" onClick={() => setOpen(false)}>Закрыть</button>
            </header>
            <div className="chat-thread" ref={thread}>
              {messages.length === 0 ? <p className="quiet">Можно спросить, что значат цифры, как они менялись и что из комплекта стоит показать врачу.</p> : null}
              {messages.map((item) => (
                <p key={`${item.at}-${item.role}-${item.text.slice(0, 24)}`} className={item.role === "user" ? "chat-user" : "chat-answer"}>
                  {readable(item.text)}
                </p>
              ))}
              {pending ? <p className="quiet">Смотрим ваши сведения…</p> : null}
              {error ? <p className="error">{error}</p> : null}
            </div>
            <form className="chat-form" onSubmit={send}>
              <textarea
                value={draft}
                rows={3}
                maxLength={1500}
                placeholder="Например: что видно по холестерину?"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={pending || !draft.trim()}>Спросить</button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
