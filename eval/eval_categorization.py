#!/usr/bin/env python3
"""
Benchmark transaction categorization against ground-truth labels.

Datasets:
  kaggle  data/kaggle_transactions.csv      (labels = its Category column, 22 US-style categories)
  ing     data/ing_demo_transactions.csv    (labels from data/ing_demo_answer_key.json)

Methods:
  baseline   keyword rules, no API (a floor to beat; runs offline)
  claude     batches transactions to the Claude Messages API (category column hidden)
  openai     same prompt via OpenAI Chat Completions (JSON mode), needs OPENAI_API_KEY

Examples:
  python3 eval_categorization.py --dataset ing --method baseline
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 eval_categorization.py --dataset kaggle --method claude --model claude-haiku-5-5
  export OPENAI_API_KEY=sk-...
  python3 eval_categorization.py --dataset kaggle --method openai --model gpt-4.1-mini
  python3 eval_categorization.py --dataset ing --method claude --limit 100 \
      --price-in 1.00 --price-out 5.00      # $ per million tokens; check current pricing

Outputs (results/):
  <dataset>_<method>_<model>_<timestamp>.json    metrics, per-category scores, confusions, usage
  <dataset>_<method>_<model>_<timestamp>_errors.csv  every misclassified row

Stdlib only: no pip install needed.
"""
import argparse, csv, json, os, re, sys, time, urllib.request, urllib.error
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent


def load_dotenv(paths=(ROOT / ".env", ROOT.parent / ".env")):
    """Read KEY=value lines from eval/.env or the repo-root .env (no dependency needed).
    Variables already set in the shell take precedence."""
    path = next((p for p in paths if p.exists()), None)
    if path is None:
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()
API_URL = "https://api.anthropic.com/v1/messages"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"


# ----------------------------------------------------------------- loading
def load_kaggle(path=ROOT / "data/kaggle_transactions.csv"):
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f)):
            rows.append({
                "id": i,
                "text": f"{r['Description']} | {r['Transaction Type']} | ${float(r['Amount']):.2f} | account: {r['Account Name']}",
                "label": r["Category"],
            })
    return rows, sorted({r["label"] for r in rows})


def load_ing(path=ROOT / "data/ing_demo_transactions.csv", key=ROOT / "data/ing_demo_answer_key.json"):
    answer = json.loads(Path(key).read_text())
    labels = {l["row_id"]: l["category"] for l in answer["labels"]}
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter=";")):
            rows.append({
                "id": i,
                "text": (f"{r['Naam / Omschrijving']} | {r['Af Bij']} EUR {r['Bedrag (EUR)']} | "
                         f"{r['Mutatiesoort']} | {r['Mededelingen']}"),
                "label": labels[i],
            })
    return rows, answer["categories"]


# ---------------------------------------------------------------- baseline
RULES = [  # (regex, category) — first match wins. Covers both datasets loosely.
    (r"salaris|paycheck|nexora|belastingdienst", ["Income", "Paycheck"]),
    (r"huur|woonstichting|mortgage", ["Housing", "Mortgage & Rent"]),
    (r"albert heijn|jumbo|lidl|ah to go|grocery|kroger|safeway|whole foods|trader joe|walmart", ["Groceries"]),
    (r"thuisbezorgd|restaurant|cafe|bar |sushi|brouwerij|thai|pizza|grill", ["Eating Out", "Restaurants"]),
    (r"coffee|starbucks|lot sixty", ["Eating Out", "Coffee Shops"]),
    (r"mcdonald|burger|taco|wendy|chick", ["Fast Food"]),
    (r"netflix|spotify|apple\.com|hulu", ["Subscriptions", "Music", "Television"]),
    (r"vattenfall|ziggo|odido|waternet|power|water|gas company|electric", ["Utilities"]),
    (r"internet|comcast|at&t", ["Internet", "Utilities"]),
    (r"phone|verizon|t-mobile", ["Mobile Phone", "Utilities"]),
    (r"zilveren kruis|centraal beheer|insurance|geico|state farm", ["Insurance", "Auto Insurance"]),
    (r"ns groep|shell|swapfiets|bp|exxon|chevron|gas station", ["Transport", "Gas & Fuel"]),
    (r"basic-fit|etos|gym", ["Health & Fitness"]),
    (r"spaarrekening|savings", ["Savings"]),
    (r"tikkie", ["Transfers"]),
    (r"credit card payment", ["Credit Card Payment"]),
    (r"home depot|lowe", ["Home Improvement"]),
    (r"bol\.com|hema|zara|action|ikea|coolblue|amazon|target", ["Shopping"]),
    (r"brewing|liquor|beer|wine", ["Alcohol & Bars"]),
    (r"barber|haircut|salon", ["Haircut"]),
    (r"cinema|movie|theater|amc", ["Movies & Dvds"]),
]


def baseline_predict(rows, categories):
    cats = set(categories)
    out = {}
    for r in rows:
        t = r["text"].lower()
        pred = "Other" if "Other" in cats else categories[0]
        for pat, options in RULES:
            if re.search(pat, t):
                hit = next((c for c in options if c in cats), None)
                if hit:
                    pred = hit
                    break
        out[r["id"]] = pred
    return out, {"input_tokens": 0, "output_tokens": 0, "api_calls": 0}


# ------------------------------------------------------------------ claude
SYSTEM = """You categorize bank transactions for a personal finance app.
Assign exactly one category to every transaction, chosen ONLY from the allowed list.
Respond with JSON only, no prose: {"results": [{"id": <int>, "category": "<category>"}, ...]}
"""


def post_json(url, payload, headers, retries=5):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={**headers, "content-type": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")
            if e.code in (429, 500, 529) and attempt < retries - 1:
                wait = 2 ** attempt * 3
                print(f"  HTTP {e.code}, retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(f"API error {e.code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt); continue
            sys.exit(f"Network error: {e}")


def call_llm(provider, api_key, model, user, max_tokens):
    """Returns (text, input_tokens, output_tokens) for either provider."""
    if provider == "claude":
        r = post_json(API_URL, {"model": model, "max_tokens": max_tokens, "system": SYSTEM,
                                "messages": [{"role": "user", "content": user}]},
                      {"x-api-key": api_key, "anthropic-version": "2023-06-01"})
        text = "".join(b.get("text", "") for b in r["content"] if b["type"] == "text")
        return text, r["usage"]["input_tokens"], r["usage"]["output_tokens"]
    # OpenAI Chat Completions, JSON mode
    r = post_json(OPENAI_URL, {"model": model, "max_completion_tokens": max_tokens,
                               "response_format": {"type": "json_object"},
                               "messages": [{"role": "system", "content": SYSTEM},
                                            {"role": "user", "content": user}]},
                  {"Authorization": f"Bearer {api_key}"})
    return (r["choices"][0]["message"]["content"] or "",
            r["usage"]["prompt_tokens"], r["usage"]["completion_tokens"])


def parse_json(text):
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        return json.loads(m.group(0)).get("results", [])
    except json.JSONDecodeError:
        return []


PROMPT_VERSIONS = {
    "v1": "category names only",
    "v2": "category names + one-line descriptions (prompts/category_descriptions.json)",
}


def category_block(categories, prompt, dataset):
    if prompt == "v1":
        return "\n".join(f"- {c}" for c in categories)
    desc = json.loads((ROOT / "prompts/category_descriptions.json").read_text())[dataset]
    return "\n".join(f"- {c}: {desc.get(c, '')}".rstrip(": ") for c in categories)


def llm_predict(provider, rows, categories, model, batch_size, prompt="v1", dataset="kaggle"):
    env = "ANTHROPIC_API_KEY" if provider == "claude" else "OPENAI_API_KEY"
    api_key = os.environ.get(env)
    if not api_key:
        sys.exit(f"Set {env} first (or use --method baseline).")
    usage = {"input_tokens": 0, "output_tokens": 0, "api_calls": 0}
    preds, cats = {}, set(categories)
    cat_list = category_block(categories, prompt, dataset)
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        lines = "\n".join(f'{r["id"]}: {r["text"]}' for r in batch)
        user = f"Allowed categories:\n{cat_list}\n\nTransactions (id: details):\n{lines}"
        text, tin, tout = call_llm(provider, api_key, model, user, max_tokens=40 * len(batch) + 200)
        usage["api_calls"] += 1
        usage["input_tokens"] += tin
        usage["output_tokens"] += tout
        for item in parse_json(text):
            try:
                preds[int(item["id"])] = item["category"]
            except (KeyError, ValueError, TypeError):
                pass
        done = min(start + batch_size, len(rows))
        print(f"  {done}/{len(rows)} classified", file=sys.stderr)
    # anything missing or outside the allowed list counts as an invalid prediction
    for r in rows:
        if r["id"] not in preds:
            preds[r["id"]] = "<missing>"
        elif preds[r["id"]] not in cats:
            preds[r["id"]] = f"<invalid:{preds[r['id']]}>"
    return preds, usage


# ----------------------------------------------------------------- metrics
def score(rows, preds, categories):
    correct = sum(preds[r["id"]] == r["label"] for r in rows)
    per = {}
    for c in categories:
        tp = sum(1 for r in rows if r["label"] == c and preds[r["id"]] == c)
        fp = sum(1 for r in rows if r["label"] != c and preds[r["id"]] == c)
        fn = sum(1 for r in rows if r["label"] == c and preds[r["id"]] != c)
        if tp + fp + fn == 0:
            continue
        p = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * rc / (p + rc) if p + rc else 0.0
        per[c] = {"support": tp + fn, "precision": round(p, 3), "recall": round(rc, 3), "f1": round(f1, 3)}
    f1s = [v["f1"] for v in per.values() if v["support"]]
    confusions = Counter((r["label"], preds[r["id"]]) for r in rows if preds[r["id"]] != r["label"])
    invalid = sum(1 for r in rows if preds[r["id"]].startswith("<"))
    return {
        "n": len(rows),
        "accuracy": round(correct / len(rows), 4),
        "macro_f1": round(sum(f1s) / len(f1s), 4) if f1s else 0.0,
        "invalid_or_missing": invalid,
        "per_category": per,
        "top_confusions": [{"true": t, "pred": p, "count": n} for (t, p), n in confusions.most_common(15)],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", choices=["kaggle", "ing"], required=True)
    ap.add_argument("--method", choices=["baseline", "claude", "openai"], default="baseline")
    ap.add_argument("--model", help="default: claude-haiku-5-5 (claude) / gpt-4.1-mini (openai)")
    ap.add_argument("--prompt", choices=list(PROMPT_VERSIONS), default="v1",
                    help="; ".join(f"{k}: {v}" for k, v in PROMPT_VERSIONS.items()))
    ap.add_argument("--batch-size", type=int, default=50)
    ap.add_argument("--limit", type=int, help="only evaluate the first N rows (cheap smoke test)")
    ap.add_argument("--price-in", type=float, help="USD per million input tokens (for cost estimate)")
    ap.add_argument("--price-out", type=float, help="USD per million output tokens")
    args = ap.parse_args()

    if not args.model:
        args.model = "gpt-4.1-mini" if args.method == "openai" else "claude-haiku-5-5"
    rows, categories = load_kaggle() if args.dataset == "kaggle" else load_ing()
    if args.limit:
        rows = rows[:args.limit]
    print(f"Dataset {args.dataset}: {len(rows)} transactions, {len(categories)} categories", file=sys.stderr)

    t0 = time.time()
    if args.method == "baseline":
        preds, usage = baseline_predict(rows, categories)
    else:
        preds, usage = llm_predict(args.method, rows, categories, args.model, args.batch_size,
                                   args.prompt, args.dataset)
    elapsed = time.time() - t0

    m = score(rows, preds, categories)
    m.update(dataset=args.dataset, method=args.method,
             model=args.model if args.method != "baseline" else None,
             prompt=args.prompt if args.method != "baseline" else None, batch_size=args.batch_size,
             seconds=round(elapsed, 1), usage=usage)
    if args.price_in is not None and args.price_out is not None:
        cost = usage["input_tokens"] / 1e6 * args.price_in + usage["output_tokens"] / 1e6 * args.price_out
        m["cost_usd"] = round(cost, 4)
        m["cost_per_1000_tx_usd"] = round(cost / len(rows) * 1000, 4)

    # report
    print(f"\n=== {args.dataset} / {args.method}" + (f" / {args.model} / prompt {args.prompt}" if args.method != "baseline" else ""))
    print(f"accuracy {m['accuracy']:.1%}   macro-F1 {m['macro_f1']:.3f}   invalid/missing {m['invalid_or_missing']}"
          f"   time {m['seconds']}s")
    if usage["api_calls"]:
        print(f"tokens in {usage['input_tokens']:,} / out {usage['output_tokens']:,} over {usage['api_calls']} calls"
              + (f"   cost ${m['cost_usd']} (${m['cost_per_1000_tx_usd']}/1k tx)" if "cost_usd" in m else ""))
    print(f"\n{'category':28} {'n':>4} {'prec':>6} {'rec':>6} {'f1':>6}")
    for c, v in sorted(m["per_category"].items(), key=lambda kv: -kv[1]["support"]):
        print(f"{c:28} {v['support']:>4} {v['precision']:>6.2f} {v['recall']:>6.2f} {v['f1']:>6.2f}")
    if m["top_confusions"]:
        print("\nTop confusions (true -> predicted):")
        for c in m["top_confusions"][:8]:
            print(f"  {c['count']:>3}x  {c['true']} -> {c['pred']}")

    out = ROOT / "results"; out.mkdir(exist_ok=True)
    tag = f"{args.dataset}_{args.method}" + (f"_{args.model}_{args.prompt}" if args.method != "baseline" else "") \
          + f"_{datetime.now():%Y%m%d-%H%M%S}"
    (out / f"{tag}.json").write_text(json.dumps(m, indent=2))
    with open(out / f"{tag}_errors.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["id", "text", "true", "predicted"])
        for r in rows:
            if preds[r["id"]] != r["label"]:
                w.writerow([r["id"], r["text"], r["label"], preds[r["id"]]])
    print(f"\nSaved results/{tag}.json and _errors.csv")


if __name__ == "__main__":
    main()
