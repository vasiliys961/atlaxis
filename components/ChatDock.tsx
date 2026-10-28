"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveAvatarDemo } from "./LiveAvatarDemo";
import { DISCUSS_EVENT } from "@/lib/discuss";
import type { ChatMode, ChatTurn } from "@/lib/types";

type TalkChannel = "written" | "voice" | "realtime";

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
  useEffect(() => {
    if (window.matchMedia("(max-width: 1100px)").matches) setCollapsed(true);
  }, []);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [mode, setMode] = useState<ChatMode>("analysis");
  const [modeLoaded, setModeLoaded] = useState(false);
  useEffect(() => { try { const saved = sessionStorage.getItem("atlaxis-chat-mode"); if (saved === "analysis" || saved === "general") setMode(saved); } catch {} setModeLoaded(true); }, []);
  useEffect(() => { if (modeLoaded) { try { sessionStorage.setItem("atlaxis-chat-mode", mode); } catch {} } }, [mode, modeLoaded]);
  const [channel, setChannel] = useState<TalkChannel>("written");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const queue = useRef<{ text: string; restore: boolean; mode: ChatMode; responseStyle: "written" | "dialogue" }[]>([]);
  const sending = useRef(false);
  const spoke = useRef(false);

  const deliver = useCallback(async (message: string, restore: boolean, mode: ChatMode, responseStyle: "written" | "dialogue" = "written"): Promise<string | undefined> => {
    const text = message.trim();
    if (!text) return;
    spoke.current = true;
    if (sending.current) {
      queue.current.push({ text, restore, mode, responseStyle });
      return;
    }
    sending.current = true;
    setCollapsed(false);
    setPending(true);
    setError("");
    setMessages((current) => [...current, { role: "user", text, mode, at: new Date().toISOString() }]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, mode, responseStyle }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось ответить.");
      setMessages(body.messages as ChatTurn[]);
      return (body.messages as ChatTurn[]).filter(item => item.role === "assistant" && (item.mode ?? "analysis") === mode).at(-1)?.text;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось ответить.");
      if (restore) setDraft(text);
    } finally {
      sending.current = false;
      setPending(false);
      const next = queue.current.shift();
      if (next) void deliver(next.text, next.restore, next.mode, next.responseStyle);
    }
  }, []);

  useEffect(() => {
    function onDiscuss(event: Event) {
      const message = (event as CustomEvent<string>).detail;
      if (typeof message === "string") { setChannel("written"); setMode("analysis"); void deliver(message, false, "analysis"); }
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
  }, [messages, pending, collapsed, mode]);

  if (pathname.startsWith("/phone") || pathname.startsWith("/review")) return null;

  async function clearChat() {
    setError("");
    const response = await fetch("/api/chat", { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Не удалось очистить переписку.");
      return;
    }
    setMessages([]);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setDraft("");
    await deliver(message, true, mode);
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
          <p>Обсуждение документов и общие вопросы с научными источниками.</p>
        </div>
        <div className="professor-actions">
          <button className="danger" type="button" onClick={() => void clearChat()} disabled={pending || messages.length === 0}>Очистить чат</button>
          <button className="secondary" type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? "Открыть" : "Свернуть"}
          </button>
        </div>
      </header>
      <div className="talk-channels" role="radiogroup" aria-label="Как обсудить">
        <button type="button" role="radio" aria-checked={channel === "written"} onClick={() => { setCollapsed(false); setChannel("written"); }}>Письменно</button>
        <button type="button" role="radio" aria-checked={channel === "voice"} onClick={() => { setCollapsed(false); setChannel("voice"); }}>Голосом</button>
        <button type="button" role="radio" aria-checked={channel === "realtime"} onClick={() => { setCollapsed(false); setChannel("realtime"); }}>В реальном времени</button>
      </div>
      {channel === "realtime" ? <p className="talk-note">Дороже обычного разговора. Пока выбран этот способ, письменный ввод и пошаговый голос на паузе: внимание только сессии с профессором. Оплата — минуты аудио OpenAI и каждый его ответ. Чтобы вернуться, выберите «Письменно» или «Голосом».</p> : null}
      {channel === "voice" ? <p className="talk-note">Вопрос голосом попадает в эту переписку. Профессор пишет ответ здесь и произносит его.</p> : null}
      {!collapsed && channel !== "written" ? <LiveAvatarDemo channel={channel} mode={mode} onQuestion={text => deliver(text, false, mode, "dialogue")} answer={readable([...messages].reverse().find(item => item.role === "assistant" && (item.mode ?? "analysis") === mode)?.text ?? "")} /> : null}
      <div className="professor-modes" role="group" aria-label="Режим разговора">
        <button type="button" aria-pressed={mode === "analysis"} onClick={() => setMode("analysis")} disabled={pending || channel === "realtime"}>По моим документам</button>
        <button type="button" aria-pressed={mode === "general"} onClick={() => setMode("general")} disabled={pending || channel === "realtime"}>Общий вопрос</button>
      </div>
      <div className="chat-thread" ref={thread}>
        {messages.filter(item => (item.mode ?? "analysis") === mode).length === 0 ? (
          <p className="chat-answer">{mode === "general" ? "Можно задать общий вопрос. Медицинские документы и переписка по разбору в этот режим не передаются. Для медицинских вопросов ищем научные публикации." : "Обсудим находку или весь разбор, проверенные толкования и вопросы для врача."}</p>
        ) : null}
        {messages.filter(item => (item.mode ?? "analysis") === mode).map((item) => (
          <p key={`${item.at}-${item.role}-${item.text.slice(0, 24)}`} className={item.role === "user" ? "chat-user" : "chat-answer"}>
            {readable(item.text)}
            {item.sources?.length ? <span className="chat-sources">Найденные публикации (не все обязательно использованы в ответе):{item.sources.map(source => <a key={source.pmid} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ({source.year}), PMID {source.pmid}</a>)}</span> : null}
          </p>
        ))}
        {pending ? <p className="quiet">Смотрим ваши сведения…</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
      {channel === "written" ? <form className="chat-form" onSubmit={send}>
        <textarea
          value={draft}
          rows={4}
          maxLength={1500}
          placeholder={mode === "general" ? "Например: что показывает ферритин?" : "Что означают изменения в моём разборе?"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={pending || !draft.trim()}>Спросить</button>
      </form> : null}
    </aside>
  );
}
