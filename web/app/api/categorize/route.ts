import { NextResponse } from "next/server";
import { CATEGORIES, CATEGORY_NAMES } from "@/lib/categories";
import { chatCompletion, LlmError, MODEL } from "@/lib/llm";
import { rateLimited } from "@/lib/ratelimit";

type In = { id: number; description: string; note: string; amount: number };

const SYSTEM = `You categorize bank transactions for a personal finance app (Dutch bank data).
Assign exactly one category to every merchant, chosen ONLY from the allowed list.
Respond with JSON only: {"results": [{"key": <int>, "category": "<category>"}, ...]}`;

const BATCH = 40;
const CONCURRENCY = 4;

/**
 * Merchant-level categorization: transactions are grouped by normalized merchant name,
 * so the model labels each merchant once (731 rows -> ~40 merchants). Cheaper, faster, and
 * guarantees the same merchant always gets the same category.
 */
function merchantKey(t: In) {
  return `${t.description.toLowerCase().replace(/\d+/g, "").replace(/\s+/g, " ").trim()}|${t.amount < 0 ? "out" : "in"}`;
}

export async function POST(req: Request) {
  if (rateLimited(req, "categorize", 10))
    return NextResponse.json({ error: "Too many requests, wait a minute." }, { status: 429 });
  const { transactions } = (await req.json()) as { transactions: In[] };
  if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 5000)
    return NextResponse.json({ error: "Send 1-5000 transactions." }, { status: 400 });

  // group by merchant
  const groups = new Map<string, { sample: In; ids: number[] }>();
  for (const t of transactions) {
    const k = merchantKey(t);
    const g = groups.get(k);
    if (g) g.ids.push(t.id);
    else groups.set(k, { sample: t, ids: [t.id] });
  }
  const merchants = [...groups.values()];
  const catList = CATEGORY_NAMES.map((c) => `- ${c}: ${CATEGORIES[c]}`).join("\n");

  const batches: (typeof merchants)[] = [];
  for (let i = 0; i < merchants.length; i += BATCH) batches.push(merchants.slice(i, i + BATCH));

  const labels = new Map<number, string>(); // merchant index -> category
  const usage = { prompt_tokens: 0, completion_tokens: 0, calls: 0 };
  try {
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      await Promise.all(
        batches.slice(i, i + CONCURRENCY).map(async (batch, j) => {
          const offset = (i + j) * BATCH;
          const lines = batch
            .map((m, k) => {
              const s = m.sample;
              const dir = s.amount < 0 ? "money out" : "money in";
              return `${offset + k}: ${s.description} | ${dir} EUR ${Math.abs(s.amount).toFixed(2)} | ${s.note.slice(0, 90)}`;
            })
            .join("\n");
          const res = await chatCompletion({
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: `Allowed categories:\n${catList}\n\nMerchants (key: details):\n${lines}` },
            ],
          });
          usage.calls++;
          usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
          usage.completion_tokens += res.usage?.completion_tokens ?? 0;
          try {
            const parsed = JSON.parse(res.choices[0].message.content ?? "{}");
            for (const r of parsed.results ?? []) {
              if (CATEGORY_NAMES.includes(r.category)) labels.set(Number(r.key), r.category);
            }
          } catch {
            /* unparseable batch -> those merchants fall back to "Other" */
          }
        }),
      );
    }
  } catch (e) {
    const err = e instanceof LlmError ? e : new LlmError(String(e));
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const categories: Record<number, string> = {};
  merchants.forEach((m, idx) => {
    for (const id of m.ids) categories[id] = labels.get(idx) ?? "Other";
  });
  return NextResponse.json({
    categories,
    stats: { transactions: transactions.length, merchants: merchants.length, model: MODEL, ...usage },
  });
}
