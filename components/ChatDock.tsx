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
  const [collapsed, setCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/chat")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Чат не открылся.");
        setMessages(body.messages as ChatTurn[]);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages, pending, collapsed]);

  if (pathname.startsWith("/phone") || pathname.startsWith("/review")) return null;

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
    <aside className={collapsed ? "professor collapsed" : "professor"} aria-label="Окно профессора">
      <header>
        <span className="av" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#12211b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2-6 4 12 2-6h6" />
          </svg>
        </span>
        <div>
          <h2>Профессор</h2>
          <p>Спросите по вашим анализам. Разъясняет сведения, без диагноза и без лечения.</p>
        </div>
        <button className="secondary" type="button" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "Открыть" : "Свернуть"}
        </button>
      </header>
      <div className="chat-thread" ref={thread}>
        {messages.length === 0 ? (
          <p className="chat-answer">Здравствуйте. Спросите, что значат цифры, как они менялись и что из комплекта стоит показать врачу.</p>
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
