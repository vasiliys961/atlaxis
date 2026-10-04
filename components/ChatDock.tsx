"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DISCUSS_EVENT } from "@/lib/discuss";
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
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const queue = useRef<{ text: string; restore: boolean }[]>([]);
  const sending = useRef(false);
  const spoke = useRef(false);

  const deliver = useCallback(async (message: string, restore: boolean) => {
    const text = message.trim();
    if (!text) return;
    spoke.current = true;
    if (sending.current) {
      queue.current.push({ text, restore });
      return;
    }
    sending.current = true;
    setCollapsed(false);
    setPending(true);
    setError("");
    setMessages((current) => [...current, { role: "user", text, at: new Date().toISOString() }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось ответить.");
      setMessages(body.messages as ChatTurn[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось ответить.");
      if (restore) setDraft(text);
    } finally {
      sending.current = false;
      setPending(false);
      const next = queue.current.shift();
      if (next) void deliver(next.text, next.restore);
    }
  }, []);

  useEffect(() => {
    function onDiscuss(event: Event) {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === "string") void deliver(message, false);
    }
    window.addEventListener(DISCUSS_EVENT, onDiscuss);
    return () => window.removeEventListener(DISCUSS_EVENT, onDiscuss);
  }, [deliver]);

  useEffect(() => {
    let stop = false;
    void fetch("/api/chat")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Чат не открылся.");
        if (stop || spoke.current) return;
        setMessages(body.messages as ChatTurn[]);
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages, pending, collapsed]);

  if (pathname.startsWith("/phone") || pathname.startsWith("/review")) return null;

  async function clearKit() {
    setError("");
    setPending(true);
    const response = await fetch("/api/privacy/delete", { method: "POST" });
    if (!response.ok) {
      setPending(false);
      setError("Не удалось очистить файлы и переписку.");
      return;
    }
    setMessages([]);
    window.location.assign("/");
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    await deliver(message, true);
  }

  return (
    <aside className={collapsed ? "professor collapsed" : "professor"} aria-label="Окно профессора">
      <header>
        <span className="av" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#12211b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2-6 4 12 2-6h6" />
          </svg>
        </span>
        <div>
          <h2>Профессор</h2>
          <p>Очистить стирает загруженные файлы, лист и эту переписку.</p>
        </div>
        <div className="professor-actions">
          <button className="danger" type="button" onClick={() => void clearKit()} disabled={pending}>Очистить</button>
          <button className="secondary" type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? "Открыть" : "Свернуть"}
          </button>
        </div>
      </header>
      <div className="chat-thread" ref={thread}>
        {messages.length === 0 ? (
          <p className="chat-answer">Здравствуйте. Одну строку отправляет кнопка «Профессору». Весь лист — кнопка «Весь разбор профессору». Я поясню, что уже записано, без диагноза и без лечения.</p>
        ) : null}
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
    </aside>
  );
}
