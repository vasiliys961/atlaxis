"use client";

import { useEffect, useRef } from "react";

export function Scene() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const sky = host.querySelector("#L-sky");
    const far = host.querySelector("#L-far");
    const mid = host.querySelector("#L-mid");
    const ecg = host.querySelector("#L-ecg");
    const near = host.querySelector("#L-near");
    const lake = host.querySelector("#L-lake");
    const bank = host.querySelector("#L-bank");
    const motes = host.querySelector("#motes");
    if (!sky || !far || !mid || !ecg || !near || !lake || !bank || !motes) return;

    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ridge = {
      far: (x: number) => 520 - Math.abs(Math.sin(x * 0.0055 + 1.2)) * 95 - Math.abs(Math.sin(x * 0.012 + 0.4)) * 38,
      mid: (x: number) => 610 - Math.sin(x * 0.004 + 2) * 55 - Math.sin(x * 0.011 + 1) * 22 - Math.abs(Math.sin(x * 0.007)) * 28,
      near: (x: number) => 715 - Math.sin(x * 0.0035 + 0.5) * 48 - Math.sin(x * 0.009 + 3) * 20,
    };
    const poly = (fn: (x: number) => number) => {
      let path = `M-60,1000 L-60,${fn(-60).toFixed(1)}`;
      for (let x = -60; x <= 1660; x += 10) path += ` L${x},${fn(x).toFixed(1)}`;
      return `${path} L1660,1000Z`;
    };
    const cloud = (x: number, y: number, scale: number, extra: string) =>
      `<g class="cloud ${extra}" transform="translate(${x} ${y}) scale(${scale})" fill="#fff" opacity=".7" filter="url(#soft)"><ellipse cx="0" cy="0" rx="130" ry="22"/><ellipse cx="-50" cy="-16" rx="62" ry="24"/><ellipse cx="38" cy="-22" rx="74" ry="28"/></g>`;

    sky.innerHTML = `<circle cx="930" cy="470" r="300" fill="url(#glow)"/><circle cx="930" cy="470" r="62" fill="#fff6d8"/><circle cx="930" cy="470" r="62" fill="none" stroke="#ffe3a8" stroke-width="10" opacity=".5"/>${cloud(250, 170, 1.1, "")}${cloud(760, 110, 0.8, "c2")}${cloud(1320, 220, 1, "")}${cloud(520, 330, 0.7, "c2")}`;
    far.innerHTML = `<path d="${poly(ridge.far)}" fill="url(#gFar)"/><path d="${poly((x) => ridge.far(x) + 24)}" fill="#c9dad0" opacity=".45"/>`;
    mid.innerHTML = `<path d="${poly(ridge.mid)}" fill="url(#gMid)"/>`;

    const base = 575;
    const points: number[][] = [[-20, base]];
    for (let beat = 80; beat < 1700; beat += 380) {
      points.push(
        [beat, base], [beat + 28, base], [beat + 42, base - 14], [beat + 58, base], [beat + 82, base],
        [beat + 92, base + 12], [beat + 108, base - 92], [beat + 124, base + 34], [beat + 138, base],
        [beat + 176, base], [beat + 196, base - 20], [beat + 218, base],
      );
    }
    points.push([1700, base]);
    const line = `M${points.map((point) => point.join(",")).join(" L")}`;
    ecg.innerHTML = `<path d="${line}" fill="none" stroke="#fff8e6" stroke-opacity=".5" stroke-width="2" stroke-linejoin="round"/><path class="pulse" pathLength="1" d="${line}" fill="none" stroke="#c8553d" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#bloom)"/>`;

    let trees = `<path d="${poly(ridge.near)}" fill="url(#gNear)"/>`;
    for (let x = 20; x < 1620; x += 24 + rnd() * 34) {
      const y = ridge.near(x) + 6;
      const height = 30 + rnd() * 48;
      const width = 6 + rnd() * 5;
      const color = rnd() > 0.5 ? "#1f5744" : "#276651";
      trees += rnd() > 0.35
        ? `<path d="M${x},${y} q${-width},${-height * 0.5} 0,${-height} q${width},${height * 0.5} 0,${height}z" fill="${color}"/>`
        : `<path d="M${x},${y - height} l${-width * 1.6},${height * 0.55} h${width * 0.9} l${-width * 1.3},${height * 0.45} h${width * 4} l${-width * 1.3},${-height * 0.45} h${width * 0.9}z" fill="${color}"/>`;
    }
    near.innerHTML = trees;

    let water = `<rect x="-60" y="800" width="1720" height="260" fill="url(#gLake)"/>`;
    for (let index = 0; index < 9; index += 1) {
      const span = (70 - index * 5) * (1 + index * 0.12);
      water += `<rect class="shimmer" style="animation-delay:${-index * 0.45}s" x="${930 - span}" y="${812 + index * 15}" width="${span * 2}" height="3.4" rx="2" fill="#fff4d2"/>`;
    }
    lake.innerHTML = water;

    let shore = `<path d="M-60,1000 L-60,935 C260,890 560,962 880,930 S1400,896 1660,940 L1660,1000Z" fill="url(#gBank)"/>`;
    for (let index = 0; index < 90; index += 1) {
      const x = rnd() * 1650 - 20;
      const y = 940 + rnd() * 20;
      const height = 14 + rnd() * 34;
      shore += `<path d="M${x},${y} q${rnd() * 8 - 4},${-height / 2} ${rnd() * 14 - 7},${-height}" stroke="#2f7a60" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".85"/>`;
    }
    bank.innerHTML = shore;

    motes.replaceChildren();
    for (let index = 0; index < 18; index += 1) {
      const mote = document.createElement("i");
      mote.style.left = `${rnd() * 100}%`;
      mote.style.animationDuration = `${14 + rnd() * 18}s`;
      mote.style.animationDelay = `${-rnd() * 30}s`;
      const size = `${3 + rnd() * 4}px`;
      mote.style.width = size;
      mote.style.height = size;
      motes.appendChild(mote);
    }
  }, []);

  return (
    <div ref={root}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <symbol id="d-micro" viewBox="0 0 120 120">
            <ellipse cx="60" cy="110" rx="40" ry="6" fill="#12211b" opacity=".12" />
            <rect x="22" y="98" width="64" height="11" rx="5.5" fill="#1d4b3b" />
            <path d="M72 98 C104 96 106 52 64 46" fill="none" stroke="#2b6a54" strokeWidth="11" strokeLinecap="round" />
            <rect x="35" y="14" width="19" height="52" rx="8" transform="rotate(-28 44 40)" fill="#12211b" />
            <rect x="24" y="11" width="15" height="10" rx="3" transform="rotate(-28 31 16)" fill="#b5744b" />
            <rect x="51" y="64" width="10" height="13" rx="3" transform="rotate(-28 56 70)" fill="#b5744b" />
            <rect x="30" y="82" width="46" height="6" rx="3" fill="#12211b" />
            <circle cx="52" cy="95" r="3.2" fill="#f6e4d4" />
          </symbol>
          <symbol id="d-steth" viewBox="0 0 120 120">
            <path d="M30 16 C30 54 60 58 60 76 M90 16 C90 54 60 58 60 76" fill="none" stroke="#12211b" strokeWidth="5" strokeLinecap="round" />
            <path d="M60 76 C60 104 94 100 94 80" fill="none" stroke="#12211b" strokeWidth="5" strokeLinecap="round" />
            <circle cx="30" cy="13" r="6" fill="#b5744b" /><circle cx="90" cy="13" r="6" fill="#b5744b" />
            <circle cx="94" cy="95" r="15" fill="#d5ddd8" stroke="#12211b" strokeWidth="4" />
            <circle cx="94" cy="95" r="6.5" fill="#2b6a54" />
          </symbol>
          <symbol id="d-therm" viewBox="0 0 120 120">
            <g transform="rotate(38 60 60)">
              <rect x="52" y="8" width="16" height="80" rx="8" fill="#fffcf6" stroke="#12211b" strokeWidth="3.5" />
              <circle cx="60" cy="95" r="14" fill="#fffcf6" stroke="#12211b" strokeWidth="3.5" />
              <circle cx="60" cy="95" r="8" fill="#c8553d" />
              <rect x="57.5" y="42" width="5" height="52" rx="2.5" fill="#c8553d" />
            </g>
          </symbol>
          <symbol id="d-oxi" viewBox="0 0 120 120">
            <rect x="12" y="34" width="96" height="54" rx="18" fill="#2b6a54" />
            <rect x="22" y="43" width="62" height="32" rx="7" fill="#12211b" />
            <circle cx="97" cy="59" r="6" fill="#b5744b" />
          </symbol>
          <symbol id="d-gauge" viewBox="0 0 120 120">
            <circle cx="60" cy="58" r="44" fill="#fffcf6" stroke="#12211b" strokeWidth="4.5" />
            <path d="M24 50 A38 38 0 0 1 78 22" fill="none" stroke="#e2b04f" strokeWidth="5" strokeLinecap="round" />
            <path d="M86 26 A38 38 0 0 1 98 70" fill="none" stroke="#c8553d" strokeWidth="5" strokeLinecap="round" />
            <line x1="60" y1="58" x2="60" y2="34" stroke="#b5744b" strokeWidth="3.2" strokeLinecap="round" transform="rotate(38 60 58)" />
            <circle cx="60" cy="58" r="5" fill="#12211b" />
          </symbol>
        </defs>
      </svg>
      <div className="scene" aria-hidden="true">
        <svg className="land" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">
          <defs>
            <radialGradient id="glow" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fff3c9" stopOpacity=".95" />
              <stop offset=".35" stopColor="#ffd89a" stopOpacity=".5" />
              <stop offset="1" stopColor="#ffc78a" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="gFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b6cdc7" /><stop offset="1" stopColor="#e6dcc3" /></linearGradient>
            <linearGradient id="gMid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#85ae9d" /><stop offset="1" stopColor="#c9cfae" /></linearGradient>
            <linearGradient id="gNear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4f8c74" /><stop offset="1" stopColor="#2f6a55" /></linearGradient>
            <linearGradient id="gLake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f1d7b0" /><stop offset=".35" stopColor="#9fc7bf" /><stop offset="1" stopColor="#4f8f84" /></linearGradient>
            <linearGradient id="gBank" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a6450" /><stop offset="1" stopColor="#173e31" /></linearGradient>
            <filter id="soft"><feGaussianBlur stdDeviation="7" /></filter>
            <filter id="bloom" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <g className="layer" id="L-sky" />
          <g className="layer" id="L-far" />
          <g className="layer" id="L-mid" />
          <g className="layer" id="L-ecg" />
          <g className="layer" id="L-near" />
          <g className="layer" id="L-lake" />
          <g className="layer" id="L-bank" />
        </svg>
      </div>
      <div className="motes" id="motes" aria-hidden="true" />
    </div>
  );
}
