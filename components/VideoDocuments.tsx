"use client";
import { useEffect, useRef, useState } from "react";
import { extractVideoPages, MAX_VIDEO_PAGES, type VideoPage } from "@/lib/video-document";
export function VideoDocuments({endpoint="/api/documents",code,onSent}:{endpoint?:string;code?:string;onSent?:()=>void}) {
  const [pages,setPages]=useState<VideoPage[]>([]), [selected,setSelected]=useState<number[]>([]), [busy,setBusy]=useState(false), [message,setMessage]=useState(""), [error,setError]=useState("");
  const camera=useRef<HTMLInputElement>(null), input=useRef<HTMLInputElement>(null), controller=useRef<AbortController|null>(null), saved=useRef<VideoPage[]>([]);
  useEffect(()=>()=>{controller.current?.abort();saved.current.forEach(p=>URL.revokeObjectURL(p.preview));},[]);
  async function choose(file?:File) {
    if(!file)return; controller.current?.abort(); const task=new AbortController(); controller.current=task;
    saved.current.forEach(p=>URL.revokeObjectURL(p.preview)); saved.current=[];setPages([]);setSelected([]);setBusy(true);setError("");
    try {const result=await extractVideoPages(file,task.signal,(n,total)=>setMessage(`Выбираем кадры на устройстве: ${n} из ${total}`)); saved.current=result.pages;setPages(result.pages);setMessage(`Кандидатов: ${result.pages.length}. Точных повторов удалено: ${result.duplicates}. Кадров сверх лимита размера пропущено: ${result.skipped}. Выборка может пропустить листы; проверьте ролик и выберите один читаемый кадр каждого листа.`);}
    catch(reason){setError(reason instanceof Error?reason.message:"Не удалось прочитать видео.");}
    finally{setBusy(false);}
  }
  async function send(){
    if(!selected.length)return;if(endpoint==="/api/phone"&&!code){setError("Нужна действующая ссылка с компьютера.");return;}
    setBusy(true);setError("");
    try {const form=new FormData();form.set("source","video_documents");if(code)form.set("code",code);selected.forEach(i=>form.append("files",pages[i].file));const response=await fetch(endpoint,{method:"POST",body:form});const body=await response.json();if(!response.ok)throw new Error(body.error??"Не удалось отправить страницы.");setMessage(`${selected.length} страниц приняты. Результат чтения каждой страницы появится в списке документов.`);setSelected([]);onSent?.();}
    catch(reason){setError(reason instanceof Error?reason.message:"Ошибка отправки.");}finally{setBusy(false);}
  }
  return <section className="card video-documents"><h3>Документы одним видео</h3><p className="quiet">Снимайте каждый лист целиком и неподвижно несколько секунд. До 90 секунд и 80 МБ. Ролик остаётся на устройстве; отправляются только выбранные фотографии страниц. Это не анализ видеопетель УЗИ.</p>
    <button type="button" disabled={busy} onClick={()=>camera.current?.click()}>Снять видео документов</button><button type="button" className="secondary" disabled={busy} onClick={()=>input.current?.click()}>Выбрать готовое видео</button><input ref={camera} hidden type="file" accept="video/*" capture="environment" onChange={e=>{void choose(e.target.files?.[0]);e.target.value="";}} /><input ref={input} hidden type="file" accept="video/mp4,video/quicktime,video/webm,video/*" onChange={e=>{void choose(e.target.files?.[0]);e.target.value="";}} />
    {busy&&controller.current&&!pages.length?<button type="button" className="secondary" onClick={()=>controller.current?.abort()}>Отменить выбор кадров</button>:null}
    {message?<p className="quiet" role="status">{message}</p>:null}{error?<p className="error">{error}</p>:null}
    {pages.length?<><p>Выберите максимум {MAX_VIDEO_PAGES} страниц. Изображение должно читаться при увеличении. Уберите повторы и кадры с несколькими мелкими листами. Оценка резкости не гарантирует читаемость текста.</p><div className="video-pages">{pages.map((page,i)=><label key={page.preview} className="video-page"><a href={page.preview} target="_blank" rel="noopener noreferrer"><img loading="lazy" decoding="async" src={page.preview} alt={`Кадр на ${page.seconds.toFixed(1)} секунде`} /></a><span><input type="checkbox" checked={selected.includes(i)} disabled={busy||(!selected.includes(i)&&selected.length>=MAX_VIDEO_PAGES)} onChange={e=>setSelected(current=>e.target.checked?[...current,i]:current.filter(n=>n!==i))} /> {page.seconds.toFixed(1)} с · резкость {page.sharpness}</span></label>)}</div><p className="quiet">Выбрано {selected.length}. До {selected.length} вызовов OCR; затем один общий разбор с проверкой и поиск источников. Цена зависит от провайдера и объёма ответа — достоверной оценки в рублях пока нет. Точные повторы уже загруженных файлов повторно не читаются.</p><button type="button" disabled={busy||!selected.length} onClick={()=>void send()}>{busy?"Отправляем…":`Отправить выбранные страницы (${selected.length})`}</button></>:null}
  </section>;
}
