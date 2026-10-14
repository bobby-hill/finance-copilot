# Ledger: AI finance copilot

Upload a bank export (ING or any CSV). Transactions are categorized by an LLM, and a chat agent answers
questions by calling **deterministic tools**, so every number comes from code, not from the model.

## Quick start

**Docker (recommended)**
```bash
cp .env.example .env        # paste your OPENAI_API_KEY
docker compose up --build
# open http://localhost:3000 and click "Try with sample data"
```

**Local dev**
```bash
cd web
npm install
npm run dev                 # reads ../.env automatically
```

## How it works
```
Browser (Next.js/React)                     Server (Next.js API routes)            OpenAI
───────────────────────                     ───────────────────────────            ──────
CSV parsed client-side  ── merchants ──▶  /api/categorize                    ──▶  JSON-mode call
dashboard (pure TS tools)                   groups 731 tx → 46 merchants,           (batched, 4 parallel)
                                            labels each merchant once
chat panel             ── question ───▶  /api/chat  agent loop (≤6 steps)  ◀──▶  function calling
  shows tool trace     ◀── answer + trace   runs tools: get_overview, summarize_spending,
                                            list_transactions, find_recurring, find_duplicates
```

- **No hallucinated numbers:** the system prompt forbids arithmetic; the agent must call tools (`web/lib/tools.ts`).
  The UI shows every tool call, its arguments and its result.
- **Merchant-level categorization:** one label per merchant instead of per row (731 rows → 46 merchants, 2 API calls), so it is much cheaper and
  always consistent (the same merchant can't get two categories).
- **Category definitions in the prompt:** chosen by the eval (see below).
- **API key stays server-side;** simple per-IP rate limiting; clear error when credit runs out.
- **Privacy:** the file is parsed in the browser; nothing is stored on the server.

## Evaluation (`eval/`)
| Method | Accuracy | Macro-F1 |
|---|---|---|
| Keyword rules | 85.1% | 0.655 |
| gpt-4.1-mini, category names (v1) | 92.8% | 0.803 |
| gpt-4.1-mini, + category definitions (v2) | **95.3%** | **0.833** |

Kaggle personal-finance dataset, 806 labeled transactions. Most remaining errors come from inconsistent labels
(e.g. Netflix labeled both "Movies & Dvds" and "Television"), which put the ceiling at ~98%.
See `eval/README.md`.

## Project layout
```
web/            Next.js app (UI + API routes), Dockerfile
eval/           Python benchmark: synthetic ING data generator, answer key, eval + comparison scripts
docker-compose.yml
.env.example
```
