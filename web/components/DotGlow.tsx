"use client";

import { useEffect, useRef } from "react";

const GAP = 28;
const RADIUS = 150;
const FADE_MS = 500; // how long a lit dot takes to fade out after the cursor leaves it

/** Dot grid whose dots light up under the cursor and then fade out gradually. */
export default function DotGlow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let level = new Float32Array(0);
    let mouse: { x: number; y: number } | null = null;
    let raf = 0;
    let last = performance.now();
    let color = "#8f9cff";

    function resize() {
      const r = host!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / GAP) + 1;
      level = new Float32Array(cols * (Math.ceil(h / GAP) + 1));
    }

    function frame(now: number) {
      const dt = now - last;
      last = now;
      const decay = dt / FADE_MS;
      ctx!.clearRect(0, 0, w, h);
      let live = false;
      for (let i = 0; i < level.length; i++) {
        const x = (i % cols) * GAP + GAP / 2;
        const y = Math.floor(i / cols) * GAP + GAP / 2;
        if (mouse) {
          const d = Math.hypot(x - mouse.x, y - mouse.y);
          if (d < RADIUS) level[i] = Math.max(level[i], (1 - d / RADIUS) ** 2);
        }
        if (level[i] > 0.01) {
          live = true;
          ctx!.globalAlpha = level[i];
          ctx!.fillStyle = color;
          ctx!.beginPath();
          ctx!.arc(x, y, 1.2 + level[i] * 1.2, 0, Math.PI * 2);
          ctx!.fill();
          level[i] = Math.max(0, level[i] - decay);
        }
      }
      raf = live || mouse ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || color;
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }
    function move(e: MouseEvent) {
      const r = host!.getBoundingClientRect();
      mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      start();
    }
    function leave() {
      mouse = null;
    }

    resize();
    window.addEventListener("resize", resize);
    host.addEventListener("mousemove", move);
    host.addEventListener("mouseleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      host.removeEventListener("mousemove", move);
      host.removeEventListener("mouseleave", leave);
    };
  }, []);

  return <canvas ref={ref} className="dots-glow" aria-hidden />;
}
