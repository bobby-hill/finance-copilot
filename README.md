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
                                            list_transactions, find_recurring, find_duplicates, get_balance
```

- **No hallucinated numbers:** the system prompt forbids arithmetic; the agent must call tools (`web/lib/tools.ts`).
  The UI shows every tool call, its arguments and its result.
- **Merchant-level categorization:** one label per merchant instead of per row (731 rows → 46 merchants, 2 API calls), so it is much cheaper and
  always consistent (the same merchant can't get two categories).
- **Category definitions in the prompt:** chosen by the eval (see below).
- **API key stays server-side;** simple per-IP rate limiting; clear error when credit runs out.
- **Privacy:** the file is parsed in the browser; nothing is stored on the server.

## Evaluation (`eval/`)

### 1. Categorization
| Method | Accuracy | Macro-F1 |
|---|---|---|
| Keyword rules | 85.1% | 0.655 |
| gpt-4.1-mini, category names (v1) | 92.8% | 0.803 |
| gpt-4.1-mini, + category definitions (v2) | **95.3%** | **0.833** |

Kaggle personal-finance dataset, 806 labeled transactions. Most remaining errors come from inconsistent labels
(e.g. Netflix labeled both "Movies & Dvds" and "Television"), which put the ceiling at ~98%.
See `eval/README.md`.

### 2. Chat agent (`eval/eval_chat.py`)
14 questions with known answers, asked against a synthetic ING export whose patterns I planted (a forgotten gym
membership, a subscription price rise, a double charge, a salary change, ...). Each answer is checked for exact numbers
(to the cent, or correctly rounded), whether a sensible tool was called, and **grounding**: every number in the answer
must appear in a tool result, otherwise the model did its own math.

| | First run | After fixes |
|---|---|---|
| Correct answers | 10/14 (71%) | **42/42** (14 questions x 3 runs) |
| Avg tool calls / tokens per question | 1.07 / 1,605 | 1.1 / 2,298 |
| Median latency | ~2 s | ~2.0 s |

gpt-4.1-mini, true categories from the answer key (so this measures the agent, not the categorizer).

The first run exposed four real problems, fixed in the tools rather than by prompt tweaks:
- **No balance tool:** the agent couldn't answer "what's my balance?" -> added `get_balance`.
- **Model did its own division** and got an average slightly wrong (583.36 vs 582.53), which my first scoring tolerance let
  pass -> `average_per_month` is now computed in code and scoring is exact.
- **"Subscriptions" was ambiguous:** it answered EUR 29.97 in one question and listed five subscriptions in another ->
  `find_recurring` now separates essential bills from discretionary recurring charges (EUR 84.86 / month).
- **Income counted as a "purchase":** the biggest "purchase" was a salary payment -> `exclude_recurring` option.

The price of the extra tools and rules is ~43% more tokens per question.

**Limits, stated plainly**
- These are *development* questions: I changed the tools after seeing them, so 42/42 is not a held-out score.
  Grounding was reported but not yet enforced in this run (one answer in 42 computed a ratio itself); it now fails the question.
- Single-turn questions only; one synthetic dataset; no adversarial inputs yet.
- Not yet measured: the full pipeline including categorization (`--categorize`), and a held-out question set.

## Project layout
```
web/            Next.js app (UI + API routes), Dockerfile
eval/           Python benchmark: synthetic ING data generator, answer key, eval + comparison scripts
docker-compose.yml
.env.example
```
