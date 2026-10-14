import "server-only";

/** Minimal OpenAI Chat Completions client (plain fetch, no SDK). Server-side only: the key never reaches the browser. */
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

export class LlmError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export type Usage = { prompt_tokens: number; completion_tokens: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function chatCompletion(body: Record<string, any>, retries = 3): Promise<any> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new LlmError("OPENAI_API_KEY is not set. Add it to the .env file in the project root.", 500);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, ...body }),
    });
    if (res.ok) return res.json();
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.code as string | undefined;
    if (code === "insufficient_quota")
      throw new LlmError("API credit exhausted for this key. Top up the OpenAI account or use another key.", 402);
    if (res.status === 401) throw new LlmError("Invalid OpenAI API key.", 401);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    throw new LlmError(err?.error?.message || `OpenAI error ${res.status}`, res.status);
  }
}
