"use client";

import { useRef, useState } from "react";
import Logo from "./Logo";

type Props = { onLoad: (text: string, name: string) => void; busy: boolean; count: number; error: string | null };

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
    <div className="glow flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center gap-3 px-6 py-6">
        <Logo />
        <span className="font-semibold tracking-tight">Ledger</span>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 pb-24">
        <p className="rise mb-4 font-mono text-xs uppercase tracking-[0.2em] text-mint-400">AI finance copilot</p>
        <h1 className="rise text-4xl font-semibold leading-tight tracking-tight sm:text-5xl" style={{ animationDelay: "60ms" }}>
          Drop in your bank export.
          <br />
          <span className="text-ink-400">Ask it anything.</span>
        </h1>
        <p className="rise mt-5 max-w-xl text-ink-300" style={{ animationDelay: "120ms" }}>
          Transactions are categorized by an LLM, then an agent answers your questions by calling deterministic tools,
          so every number is computed from your data, never guessed.
        </p>

        <div
          className={`rise mt-10 rounded-2xl border border-dashed p-8 text-center transition ${
            drag ? "border-mint-400 bg-mint-500/5" : "border-ink-600 bg-ink-900/60"
          }`}
          style={{ animationDelay: "180ms" }}
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
          {busy ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-mint-400" />
              <p className="text-ink-300">
                Categorizing <span className="num font-medium text-ink-100">{count}</span> transactions…
              </p>
              <p className="text-xs text-ink-400">Grouping by merchant so each one is labeled once</p>
            </div>
          ) : (
            <>
              <p className="text-ink-100">Drag a CSV here</p>
              <p className="mt-1 text-sm text-ink-400">ING export, or any CSV with date / description / amount columns</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  onClick={() => input.current?.click()}
                  className="rounded-xl border border-ink-600 bg-ink-800 px-4 py-2.5 text-sm font-medium hover:bg-ink-700"
                >
                  Choose file
                </button>
                <button
                  onClick={sample}
                  className="rounded-xl bg-mint-400 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_0_30px_-8px_rgba(94,234,212,.7)] hover:bg-mint-500"
                >
                  Try with sample data →
                </button>
              </div>
              <input
                ref={input}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
              />
            </>
          )}
        </div>
        {error && (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
        )}
        <p className="mt-6 text-xs text-ink-400">
          Your file is parsed in the browser. Only merchant names and amounts are sent to the model for categorization.
        </p>
      </main>
    </div>
  );
}
