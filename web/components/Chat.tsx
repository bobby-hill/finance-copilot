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
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
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
      <div className="flex items-center justify-between px-6 pb-3 pt-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Ask your money</h2>
          <p className="text-[15px] text-muted">Answers are computed by tools, not guessed</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className="link text-[15px]">
            Clear
          </button>
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="mb-3 text-[15px] text-muted">Try asking:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-lg border border-line bg-bg px-4 py-3 text-left text-[15px] transition-colors hover:bg-surface-2 active:translate-y-px"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="rise flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-bg">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="rise space-y-2">
              {m.trace && m.trace.length > 0 && <Trace trace={m.trace} usage={m.usage} />}
              <div className={`text-[16px] leading-relaxed ${m.error ? "rounded-lg border border-line bg-surface-2 px-4 py-3 text-ink" : ""}`}>
                <Rich text={m.content} />
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[15px] text-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </span>
            Thinking and calling tools…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="p-4"
      >
        <div className="flex items-center gap-2 rounded-xl border border-line bg-bg pl-3 pr-1.5 focus-within:border-accent">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="How much did I spend on groceries in March?"
            className="chat-input flex-1 bg-transparent py-3 text-[16px] outline-none focus-visible:outline-none placeholder:text-muted"
          />
          <button
            disabled={busy || !input.trim()}
            className="btn min-h-9"
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
    <div className="rounded-lg border border-line bg-bg text-[14px]">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold hover:bg-surface-2">
        <span>
          {trace.length} tool call{trace.length > 1 ? "s" : ""}:{" "}
          {[...new Set(trace.map((t) => t.name))].join(", ")}
        </span>
        <span>
          {usage && `${(usage.prompt_tokens + usage.completion_tokens).toLocaleString()} tok · `}
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          {trace.map((t, i) => (
            <div key={i}>
              <p className="font-semibold">
                {t.name}
                <span className="font-normal text-muted">({JSON.stringify(t.args)})</span>
              </p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-[12px]">
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
            <strong key={j} className="font-semibold">
              {p.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        );
        if (!line.trim()) return <div key={i} className="h-2" />;
        return bullet ? (
          <p key={i} className="flex gap-2 pl-1">
            <span>•</span>
            <span>{content}</span>
          </p>
        ) : (
          <p key={i}>{content}</p>
        );
      })}
    </>
  );
}
