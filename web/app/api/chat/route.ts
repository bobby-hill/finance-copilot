import { NextResponse } from "next/server";
import { CATEGORY_NAMES } from "@/lib/categories";
import { chatCompletion, LlmError, MODEL } from "@/lib/llm";
import { rateLimited } from "@/lib/ratelimit";
import { runTool, TOOL_SCHEMAS } from "@/lib/tools";
import type { ChatMessage, ToolTrace, Transaction } from "@/lib/types";

const MAX_STEPS = 6;

function systemPrompt(txs: Transaction[]) {
  const dates = txs.map((t) => t.date).sort();
  return `You are a personal finance copilot. The user uploaded ${txs.length} bank transactions from ${dates[0]} to ${dates[dates.length - 1]}. Amounts are in EUR.

Rules:
- NEVER compute or estimate numbers yourself. Every amount, count or percentage you state must come from a tool result. Call tools as many times as needed (e.g. once per period when comparing).
- Categories available: ${CATEGORY_NAMES.join(", ")}.
- Merchant filters are substring matches on the description (e.g. "thuisbezorgd", "albert heijn").
- Be concise and concrete: lead with the answer, then 1-3 short supporting points. Use **bold** for key numbers. No tables, no headings.
- When relevant, add one practical suggestion (e.g. a subscription that looks unused).
- If the data cannot answer the question, say so.`;
}

export async function POST(req: Request) {
  if (rateLimited(req, "chat", 20))
    return NextResponse.json({ error: "Too many messages, wait a minute." }, { status: 429 });
  const { messages, transactions } = (await req.json()) as { messages: ChatMessage[]; transactions: Transaction[] };
  if (!messages?.length || !transactions?.length)
    return NextResponse.json({ error: "Missing messages or transactions." }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convo: any[] = [
    { role: "system", content: systemPrompt(transactions) },
    ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
  ];
  const trace: ToolTrace[] = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chatCompletion({ temperature: 0.2, messages: convo, tools: TOOL_SCHEMAS });
      usage.calls++;
      usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
      usage.completion_tokens += res.usage?.completion_tokens ?? 0;
      const msg = res.choices[0].message;
      convo.push(msg);
      if (!msg.tool_calls?.length) {
        return NextResponse.json({ answer: msg.content ?? "", trace, usage: { ...usage, model: MODEL } });
      }
      for (const call of msg.tool_calls) {
        const t0 = Date.now();
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          /* bad JSON from the model -> run with no args */
        }
        const result = runTool(call.function.name, args, transactions);
        trace.push({ name: call.function.name, args, result, ms: Date.now() - t0 });
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return NextResponse.json({
      answer: "I needed too many steps to answer that. Try a more specific question.",
      trace,
      usage: { ...usage, model: MODEL },
    });
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError(String(e));
    return NextResponse.json({ error: err.message, trace }, { status: err.status });
  }
}
