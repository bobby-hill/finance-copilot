"use client";

import { useRef, useState } from "react";
import DotGlow from "./DotGlow";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

type Props = { onLoad: (text: string, name: string) => void; busy: boolean; count: number; error: string | null };

const STAGES = [
  { n: "01", when: "In your browser", what: "Your CSV is read locally. The file itself is never uploaded." },
  { n: "02", when: "Once per merchant", what: "A model labels each merchant a single time, not each transaction." },
  { n: "03", when: "On every question", what: "An agent calls tools that do the sums, so every figure is exact." },
];

export default function Landing({ onLoad, busy, count, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  async function readFile(f: File) {
    onLoad(await f.text(), f.name);
  }
  async function sample() {
    const res = await fetch("/sample/ing_demo_transactions.csv");
    onLoad(await res.text(), "Sample ING export (12 months)");
  }

  return (
    <div className="min-h-screen">
      <section
        className="relative flex min-h-svh flex-col overflow-hidden px-4 pb-10 transition-colors sm:px-10"
        style={drag ? { background: "var(--surface-2)" } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) readFile(f);
        }}
      >
        <div className="dots" aria-hidden />
        <DotGlow />
        <header className="relative flex items-center justify-between py-5 text-[15px]">
          <span className="flex items-center gap-2.5 font-semibold">
            <Logo />
            Ledger
          </span>
          <div className="flex items-center gap-5">
            <a href="#how" className="link">
              How it works
            </a>
            <ThemeToggle />
          </div>
        </header>

        <div className="relative my-auto max-w-[1200px] py-16">
          <p className="eyebrow rise mb-8">AI finance copilot</p>
          <h1 className="display text-[clamp(2.75rem,8.5vw,8rem)]">
            <span className="mask-line">
              <span className="text-muted">Drop in your</span>
            </span>
            <span className="mask-line">
              <span>bank export.</span>
            </span>
          </h1>

          <div className="rise mt-12 max-w-[44ch]" style={{ animationDelay: "500ms" }}>
            <p className="text-[clamp(1.05rem,1.3vw,1.25rem)] leading-snug text-muted">
              {busy
                ? `Categorizing ${count} transactions, one label per merchant…`
                : "Then ask it anything. Every number is computed from your data, never guessed."}
            </p>
            {!busy && (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button onClick={sample} className="btn">
                  Try with sample data
                </button>
                <button onClick={() => input.current?.click()} className="btn-ghost">
                  Choose a CSV
                </button>
                <input
                  ref={input}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="card mt-6 px-4 py-3 text-[15px]">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-line px-4 pb-24 pt-24 sm:px-10">
        <p className="eyebrow mb-6">How it works</p>
        <h2 className="display max-w-[16ch] text-[clamp(2.25rem,5vw,4.5rem)]">Your numbers stay yours.</h2>
        <div className="mt-16 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.n} className="flex flex-col gap-10 bg-surface p-6 sm:min-h-64 sm:p-8">
              <span className="num text-[13px] text-muted">{s.n}</span>
              <div className="mt-auto">
                <p className="text-[clamp(1.25rem,1.8vw,1.6rem)] font-semibold leading-tight tracking-tight">{s.when}</p>
                <p className="mt-3 max-w-[30ch] text-[15px] text-muted">{s.what}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-12 max-w-[52ch] text-[15px] text-muted">
          Only merchant names and amounts are sent to the model, and only for categorization.
        </p>
      </section>
    </div>
  );
}
