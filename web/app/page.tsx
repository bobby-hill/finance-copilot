"use client";

import { useEffect, useState } from "react";
import Chat from "@/components/Chat";
import Dashboard from "@/components/Dashboard";
import Landing from "@/components/Landing";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { parseBankCsv } from "@/lib/csv";
import type { Transaction } from "@/lib/types";

type Phase = "idle" | "categorizing" | "ready" | "error";
type Stats = { transactions: number; merchants: number; calls: number; prompt_tokens: number; completion_tokens: number; model: string };

const STORAGE_KEY = "ledger:v1";

export default function Home() {
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ name: string; format: string } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  // restore last session (per-browser convenience only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        setTxs(s.txs);
        setSource(s.source);
        setStats(s.stats);
        setPhase("ready");
      }
    } catch {
      /* storage unavailable */
    }
  }, []);

  async function load(text: string, name: string) {
    setError(null);
    let parsed;
    try {
      parsed = parseBankCsv(text);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      return;
    }
    setSource({ name, format: parsed.format });
    setTxs(parsed.transactions);
    setPhase("categorizing");
    try {
      const res = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: parsed.transactions.map(({ id, description, note, amount }) => ({ id, description, note, amount })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Categorization failed");
      const categorized = parsed.transactions.map((t) => ({ ...t, category: data.categories[t.id] ?? "Other" }));
      setTxs(categorized);
      setStats(data.stats);
      setPhase("ready");
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ txs: categorized, source: { name, format: parsed.format }, stats: data.stats }),
        );
      } catch {
        /* quota or private mode */
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  function reset() {
    setTxs(null);
    setPhase("idle");
    setStats(null);
    setSource(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  if (phase !== "ready" || !txs) {
    return <Landing onLoad={load} busy={phase === "categorizing"} count={txs?.length ?? 0} error={error} />;
  }

  return (
    <div className="min-h-screen lg:flex lg:h-screen lg:flex-col lg:overflow-hidden">
      <header className="border-b border-line px-4 py-4 sm:px-10">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-[15px]">
            <Logo />
            <span className="font-semibold">Ledger</span>
            <span className="hidden sm:inline">
              {source?.name} <span className="text-muted">({source?.format})</span>
            </span>
          </div>
          <div className="flex items-center gap-6 text-[15px]">
            {stats && (
              <span className="num hidden text-muted md:inline">
                {stats.transactions} transactions → {stats.merchants} merchants · {stats.calls} calls ·{" "}
                {(stats.prompt_tokens + stats.completion_tokens).toLocaleString()} tokens · {stats.model}
              </span>
            )}
            <button onClick={reset} className="btn-ghost">
              New file
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 pb-10 pt-6 sm:px-10 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_440px] lg:pb-6">
        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
        <Dashboard txs={txs} onRecategorize={(id, category) => {
          const next = txs.map((t) => (t.id === id ? { ...t, category } : t));
          setTxs(next);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ txs: next, source, stats }));
          } catch { /* ignore */ }
        }} />
        </div>
        <div className="lg:min-h-0">
          <Chat txs={txs} />
        </div>
      </main>
    </div>
  );
}
