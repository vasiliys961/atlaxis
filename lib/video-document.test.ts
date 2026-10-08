import test from "node:test";
import assert from "node:assert/strict";
import { sampleTimes, frameSharpness, MAX_VIDEO_PAGES } from "./video-document";
test("video sampling has bounded duration and never seeks beyond final frame", () => {
  assert.equal(MAX_VIDEO_PAGES, 8);
  assert.equal(sampleTimes(90).length,60);
  assert.ok(sampleTimes(.005).every(t=>t===0));
  assert.ok(sampleTimes(8).every(t=>t>=0&&t<8));
  for(const duration of [0,NaN,Infinity,91])assert.throws(()=>sampleTimes(duration));
});
test("local sharpness ranks a uniform image below contrasting details", () => {
  const flat=new Uint8ClampedArray(16*16*4).fill(128), detail=new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)for(let c=0;c<3;c++)detail[(y*16+x)*4+c]=(x+y)%2?255:0;
  assert.equal(frameSharpness(flat,16,16),0);
  assert.ok(frameSharpness(detail,16,16)>0);
});

test("extraction control flow removes only exact frame duplicates and keeps changed pages", async () => {
  const { extractVideoPages } = await import("./video-document");
  const oldDocument = global.document, oldWindow = global.window;
  let time=0;
  class Video extends EventTarget {
    duration=4;videoWidth=16;videoHeight=16;preload="";muted=false;playsInline=false;
    set src(_value:string){queueMicrotask(()=>this.dispatchEvent(new Event("loadeddata")));}
    get currentTime(){return time;}
    set currentTime(value:number){time=value;queueMicrotask(()=>this.dispatchEvent(new Event("seeked")));}
    pause(){} removeAttribute(){} load(){}
  }
  const video=new Video();
  const canvas={width:16,height:16,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(16*16*4).fill(128)})}),toBlob:(callback:(blob:Blob)=>void)=>callback(new Blob([time<2?"PAGE 130":"PAGE 145"],{type:"image/jpeg"}))};
  global.document={createElement:(name:string)=>name==="video"?video:canvas} as unknown as Document;
  global.window={setTimeout,clearTimeout} as unknown as Window & typeof globalThis;
  try {
    const result=await extractVideoPages(new File(["fixture"],"clip.mp4"),new AbortController().signal,()=>{});
    assert.equal(result.pages.length,2);assert.equal(result.duplicates,1);assert.equal(result.skipped,0);
    assert.deepEqual(result.pages.map(p=>p.seconds),[0,3]);
    result.pages.forEach(p=>URL.revokeObjectURL(p.preview));
  }finally{global.document=oldDocument;global.window=oldWindow;}
});
