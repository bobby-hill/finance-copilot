"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ToolTrace, Transaction } from "@/lib/types";

const SUGGESTIONS = [
  "Is my takeaway spending going up?",
  "Which subscriptions am I paying for?",
  "Was I charged twice for anything?",
  "Can I afford a €1,500 trip next month?",
];

type Usage = { prompt_tokens: number; completion_tokens: number; calls: number; model: string };
type Msg = ChatMessage & { usage?: Usage; error?: boolean };

export default function Chat({ txs }: { txs: Transaction[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages([...messages, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), transactions: txs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessages((m) => [...m, { role: "assistant", content: data.answer, trace: data.trace, usage: data.usage }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card flex h-[640px] flex-col lg:h-full">
      <div className="flex items-center justify-between border-b border-ink-700/70 px-5 py-3.5">
        <div>
          <h2 className="font-medium">Ask your money</h2>
          <p className="text-xs text-ink-400">Answers are computed by tools, not guessed</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="text-xs text-ink-400 hover:text-ink-100">
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="mb-3 text-sm text-ink-400">Try asking:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-xl border border-ink-700 bg-ink-900/60 px-3.5 py-2.5 text-left text-sm text-ink-300 transition hover:border-mint-400/40 hover:text-ink-100"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="rise flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-mint-400/15 px-3.5 py-2 text-sm text-ink-100">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="rise space-y-2">
              {m.trace && m.trace.length > 0 && <Trace trace={m.trace} usage={m.usage} />}
              <div className={`text-sm leading-relaxed ${m.error ? "rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300" : "text-ink-100"}`}>
                <Rich text={m.content} />
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-mint-400" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </span>
            Thinking & calling tools…
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="border-t border-ink-700/70 p-3"
      >
        <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 focus-within:border-mint-400/50">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="How much did I spend on groceries in March?"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-ink-600"
          />
          <button
            disabled={busy || !input.trim()}
            className="rounded-lg bg-mint-400 px-3 py-1.5 text-sm font-semibold text-ink-950 disabled:opacity-30"
          >
            Ask
          </button>
        </div>
      </form>
    </section>
  );
}

/** Collapsible view of the tool calls the agent made: the "show your work" part of the demo. */
function Trace({ trace, usage }: { trace: ToolTrace[]; usage?: Usage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-950/60 font-mono text-xs">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-ink-400 hover:text-ink-100">
        <span>
          <span className="text-mint-400">⚙</span> {trace.length} tool call{trace.length > 1 ? "s" : ""}:{" "}
          {[...new Set(trace.map((t) => t.name))].join(", ")}
        </span>
        <span>
          {usage && `${(usage.prompt_tokens + usage.completion_tokens).toLocaleString()} tok · `}
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-ink-700 px-3 py-3">
          {trace.map((t, i) => (
            <div key={i}>
              <p className="text-ink-100">
                {t.name}
                <span className="text-ink-400">({JSON.stringify(t.args)})</span>
              </p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-900 p-2 text-[11px] text-ink-400">
                {JSON.stringify(t.result, null, 1).slice(0, 1800)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny renderer: **bold**, line breaks and "- " bullets. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const parts = line.replace(/^\s*[-•*]\s+/, "").split(/(\*\*[^*]+\*\*)/g);
        const content = parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={j} className="font-semibold text-white">
              {p.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        );
        if (!line.trim()) return <div key={i} className="h-2" />;
        return bullet ? (
          <p key={i} className="flex gap-2 pl-1">
            <span className="text-mint-400">•</span>
            <span>{content}</span>
          </p>
        ) : (
          <p key={i}>{content}</p>
        );
      })}
    </>
  );
}
