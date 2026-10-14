#!/usr/bin/env python3
"""
Compare all eval runs in results/ side by side.

  python3 compare_results.py                 # all runs
  python3 compare_results.py --dataset kaggle
  python3 compare_results.py --category "Restaurants" --category "Utilities"   # per-category F1 columns
"""
import argparse, json
from pathlib import Path

ROOT = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["kaggle", "ing"])
    ap.add_argument("--category", action="append", default=[], help="add per-category F1 column(s)")
    args = ap.parse_args()

    runs = []
    for f in sorted((ROOT / "results").glob("*.json")):
        m = json.loads(f.read_text())
        if args.dataset and m.get("dataset") != args.dataset:
            continue
        m["_file"] = f.stem
        m["_time"] = f.stem.rsplit("_", 1)[-1]
        runs.append(m)
    if not runs:
        print("No results yet. Run eval_categorization.py first."); return

    cols = ["dataset", "method", "model", "prompt", "n", "accuracy", "macro_f1", "invalid", "tokens", "$/1k", "secs"] \
        + [f"F1 {c}"[:18] for c in args.category]
    rows = []
    for m in runs:
        u = m.get("usage", {})
        row = [m["dataset"], m["method"], m.get("model") or "-", m.get("prompt") or ("-" if m["method"] == "baseline" else "v1"), str(m["n"]),
               f"{m['accuracy']:.1%}", f"{m['macro_f1']:.3f}", str(m["invalid_or_missing"]),
               f"{u.get('input_tokens', 0) + u.get('output_tokens', 0):,}",
               f"{m['cost_per_1000_tx_usd']:.3f}" if "cost_per_1000_tx_usd" in m else "-",
               str(m.get("seconds", "-"))]
        for c in args.category:
            pc = m["per_category"].get(c)
            row.append(f"{pc['f1']:.2f}" if pc else "-")
        rows.append(row)

    widths = [max(len(c), *(len(r[i]) for r in rows)) for i, c in enumerate(cols)]
    line = lambda r: "  ".join(v.ljust(w) for v, w in zip(r, widths))
    print(line(cols)); print("  ".join("-" * w for w in widths))
    for r in rows:
        print(line(r))
    print("\nNote: compare runs with the same n (a --limit run is not comparable to a full run).")


if __name__ == "__main__":
    main()
