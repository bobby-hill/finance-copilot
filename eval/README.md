# Eval: categorization benchmark

Run from this folder (`cd eval`). Keys are read from `../.env`.

## Files
- `data/kaggle_transactions.csv`: the Kaggle dataset (806 rows, 2018–2019, 22 labeled categories), converted from the .xlsx
- `generate_ing_demo.py`: makes `data/ing_demo_transactions.csv` (ING NL export format) and `data/ing_demo_answer_key.json`
- `eval_categorization.py`: benchmarks categorization (keyword baseline or Claude) against the labels
- `prompts/category_descriptions.json`: category definitions used by `--prompt v2`
- `compare_results.py`: table comparing every run in `results/`
- `results/`: metrics JSON and a CSV of misclassified rows for every run

## Usage
```bash
python3 generate_ing_demo.py                       # regenerate (same seed gives the same data)
python3 eval_categorization.py --dataset kaggle --method baseline
export ANTHROPIC_API_KEY=sk-ant-...
python3 eval_categorization.py --dataset kaggle --method claude --limit 100   # cheap smoke test
python3 eval_categorization.py --dataset kaggle --method claude --price-in X --price-out Y
export OPENAI_API_KEY=sk-...
python3 eval_categorization.py --dataset kaggle --method openai --model gpt-4.1-mini
```

## Answer key
`ing_demo_answer_key.json` has the true category for every row, plus 14 demo questions with known answers
(takeaway trend, subscriptions, the Spotify price increase, the forgotten Basic-Fit membership, the Bol.com
double charge, the biggest purchase, savings rate, and more). Use these as the eval set for the chat agent.

## Caveat
The keyword baseline was written knowing the merchant names in the synthetic data, so its ING score is
inflated. Use the **Kaggle** dataset for an honest Claude vs. baseline comparison.

## Prompt experiments
```bash
python3 eval_categorization.py --dataset kaggle --method openai --prompt v1   # names only
python3 eval_categorization.py --dataset kaggle --method openai --prompt v2   # names + descriptions
python3 compare_results.py --dataset kaggle --category Utilities --category Restaurants
```
To add a version: add an entry to `PROMPT_VERSIONS` and a branch in `category_block()` in `eval_categorization.py`.

## Anonymizing a real bank export
```bash
python3 anonymize_csv.py ~/Downloads/NL91INGB...csv -o data/my_export.anon.csv --redact "YourFirstName" --redact "YourLastName"
```
Replaces IBANs, private persons' names, IDs/references, e-mails, phone numbers, postcodes and addresses; businesses
are kept so categorization still works. It prints which names it treated as people and which it kept: **review both
lists** and rerun with `--person` / `--keep` / `--redact` if needed. Optional: `--scale-amounts 0.9`, `--shift-days -14`.
Keep the original export **outside** this repo.

## Chat agent eval (`eval_chat.py`)
Tests the whole agent end to end against the answer key's 14 questions. Needs the app running (`cd ../web && npm run dev`).
```bash
python3 eval_chat.py                      # 14 questions, true categories from the key (tests the agent in isolation)
python3 eval_chat.py --runs 3             # repeat: LLMs vary, so look at how stable each answer is
python3 eval_chat.py --categorize         # also run /api/categorize first (whole pipeline)
python3 eval_chat.py --judge              # LLM-as-judge for the open-ended question (q06)
python3 eval_chat.py --only q01,q05 -v    # subset, print the answers
python3 eval_chat.py --price-in 0.40 --price-out 1.60   # $ per million tokens -> cost per question
```
It reports, per question: **pass/fail** (numbers within tolerance, required facts mentioned), whether a **sensible tool**
was called, **grounding** (any number in the answer that appears in no tool result means the model did its own math),
and tokens / tool calls / seconds. Full answers and tool traces are saved to `results/chat/`.

History: the first run (10/14) exposed four real problems, fixed in the tools rather than the prompt:
no balance tool (q13), the model dividing by itself for averages (q09), no notion of "subscription" vs essential
bills (q04), and rent/income counting as "purchases" (q08). Numbers are scored strictly: exact to the cent, or
correctly rounded to whole euros.
