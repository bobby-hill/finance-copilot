#!/usr/bin/env python3
"""
Generate a realistic, synthetic ING (NL) bank export plus an answer key.

Output:
  data/ing_demo_transactions.csv   ING-style CSV (semicolon-delimited, Dutch number format)
  data/ing_demo_answer_key.json    ground-truth category per row + known answers to demo questions

The data has deliberately planted patterns so you KNOW the correct answers:
  - salary on the 25th (with a raise from April 2026 (3900 -> 4150))
  - rent, utilities, insurance, subscriptions
  - a forgotten gym membership (Basic-Fit) that is never "used"
  - Spotify price increase from July 2026
  - Thuisbezorgd (takeaway) spending that climbs over the year
  - one big Black Friday purchase at Coolblue
  - one duplicate charge at Bol.com
  - monthly savings transfers, Tikkie repayments from friends, a refund

NOTE: column names follow ING's CSV export as best known; compare with a
real export from your own ING account and adjust HEADER if ING changed it.

Usage: python3 generate_ing_demo.py [--seed 42]
"""
import argparse, csv, json, random
from datetime import date, timedelta
from collections import defaultdict
from pathlib import Path

HEADER = ["Datum", "Naam / Omschrijving", "Rekening", "Tegenrekening", "Code",
          "Af Bij", "Bedrag (EUR)", "Mutatiesoort", "Mededelingen",
          "Saldo na mutatie", "Tag"]

CATEGORIES = ["Income", "Housing", "Utilities", "Insurance", "Subscriptions",
              "Groceries", "Eating Out", "Transport", "Shopping", "Health & Fitness",
              "Savings", "Transfers", "Other"]

MY_IBAN = "NL91INGB0001234567"
SAVINGS_IBAN = "NL55INGB0007654321"
START, END = date(2025, 10, 1), date(2026, 9, 30)
START_BALANCE = 2850.00


def fake_iban(rng, bank):
    return f"NL{rng.randint(10, 99)}{bank}{rng.randint(10**9, 10**10 - 1)}"


def months():
    d = START
    while d <= END:
        yield d.year, d.month
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)


def clamp_day(y, m, day):
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return min(date(y, m, 1) + timedelta(days=day - 1), nxt - timedelta(days=1))


def nl_amount(x):
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    tx = []  # dicts: date, name, counter, code, dir, amount, kind, note, category, tags

    def add(d, name, amount, direction, category, kind="Betaalautomaat", code="BA",
            counter="", note="", tags=()):
        if START <= d <= END:
            tx.append(dict(date=d, name=name, amount=round(amount, 2), dir=direction,
                           category=category, kind=kind, code=code, counter=counter,
                           note=note, tags=list(tags)))

    ibans = {k: fake_iban(rng, b) for k, b in [
        ("employer", "ABNA"), ("landlord", "RABO"), ("vattenfall", "INGB"),
        ("ziggo", "ABNA"), ("odido", "RABO"), ("zk", "RABO"), ("basicfit", "ABNA")]}

    for y, m in months():
        # --- Income: salary on the 25th, raise from April 2026
        salary = 4150.00 if (y, m) >= (2026, 4) else 3900.00
        add(clamp_day(y, m, 25), "Nexora Digital B.V.", salary, "Bij", "Income",
            "Overschrijving", "OV", ibans["employer"],
            f"Salaris {m:02d}-{y} Omschrijving: SALARIS IBAN: {ibans['employer']}",
            ["salary"])
        # --- Housing
        add(clamp_day(y, m, 1), "Woonstichting De Grachten", 1450.00, "Af", "Housing",
            "Incasso", "IC", ibans["landlord"], "Huur woning Kerkstraat 12 Machtiging ID: HUUR-55821",
            ["recurring"])
        # --- Utilities
        add(clamp_day(y, m, 3), "Vattenfall Klantenservice N.V.", 135.00 if m in (11, 12, 1, 2) else 112.00,
            "Af", "Utilities", "Incasso", "IC", ibans["vattenfall"], "Termijnbedrag energie", ["recurring"])
        add(clamp_day(y, m, 6), "Ziggo Services B.V.", 52.50, "Af", "Utilities", "Incasso", "IC",
            ibans["ziggo"], "Ziggo internet + TV", ["recurring"])
        add(clamp_day(y, m, 14), "Odido Netherlands B.V.", 25.00, "Af", "Utilities", "Incasso", "IC",
            ibans["odido"], "Mobiel abonnement", ["recurring"])
        add(clamp_day(y, m, 22), "Waternet", 28.40, "Af", "Utilities", "Incasso", "IC",
            fake_iban(rng, "BNGH"), "Vastrecht + verbruik water", ["recurring"])
        # --- Insurance
        add(clamp_day(y, m, 1), "Zilveren Kruis Zorgverzekeringen", 148.25, "Af", "Insurance",
            "Incasso", "IC", ibans["zk"], "Premie zorgverzekering", ["recurring"])
        add(clamp_day(y, m, 2), "Centraal Beheer", 21.90, "Af", "Insurance", "Incasso", "IC",
            fake_iban(rng, "INGB"), "Inboedel + aansprakelijkheid", ["recurring"])
        # --- Subscriptions (Spotify price increase from July 2026)
        add(clamp_day(y, m, 9), "Netflix International B.V.", 13.99, "Af", "Subscriptions",
            "Incasso", "IC", "", "Netflix Standaard", ["recurring", "subscription"])
        add(clamp_day(y, m, 17), "Spotify AB", 12.99 if (y, m) >= (2026, 7) else 11.99, "Af",
            "Subscriptions", "Incasso", "IC", "", "Spotify Premium", ["recurring", "subscription"])
        add(clamp_day(y, m, 11), "Apple.com/bill", 2.99, "Af", "Subscriptions", "Online bankieren",
            "ID", "", "iCloud+ 50GB", ["recurring", "subscription"])
        # --- Forgotten gym (no other gym activity anywhere)
        add(clamp_day(y, m, 28), "Basic-Fit Nederland B.V.", 34.99, "Af", "Health & Fitness",
            "Incasso", "IC", ibans["basicfit"], "Lidmaatschap Basic-Fit Comfort",
            ["recurring", "subscription", "forgotten_gym"])
        # --- Savings
        add(clamp_day(y, m, 26), "Oranje Spaarrekening", 400.00, "Af", "Savings",
            "Online bankieren", "GT", SAVINGS_IBAN, "Naar Oranje Spaarrekening", ["savings"])

        # --- Daily life, day by day
        d = date(y, m, 1)
        month_idx = (y - START.year) * 12 + m - START.month  # 0..11
        while d.month == m:
            wd = d.weekday()
            # Groceries: ~3x/week
            if rng.random() < 0.43:
                shop = rng.choices(["ALBERT HEIJN 1427", "Jumbo Amsterdam Oost", "LIDL AMSTERDAM",
                                    "AH to go Centraal"], [5, 3, 2, 1])[0]
                amt = rng.uniform(4, 12) if "to go" in shop else rng.uniform(14, 78)
                add(d, shop, amt, "Af", "Groceries",
                    note=f"Pasvolgnr: 004 {d.strftime('%d-%m-%Y')} {rng.randint(8,21):02d}:{rng.randint(0,59):02d} "
                         f"Transactie: {rng.randint(10**7, 10**8-1)} Term: {rng.choice(['CT','AH','JU'])}{rng.randint(100,999)}")
            # Takeaway: probability climbs over the year (≈4/month -> ≈11/month)
            p_take = 0.13 + 0.022 * month_idx
            if wd >= 4: p_take *= 1.5
            if rng.random() < p_take:
                add(d, "Thuisbezorgd.nl via Stichting Mollie Payments", rng.uniform(19, 42), "Af",
                    "Eating Out", "iDEAL", "ID", "NL22DEUT0265186439",
                    f"Bestelling {rng.randint(10**8, 10**9-1)} Thuisbezorgd.nl", ["takeaway"])
            # Coffee on workdays
            if wd < 5 and rng.random() < 0.3:
                add(d, rng.choice(["Coffee Company Wibautstr", "Starbucks Amsterdam CS", "Lot Sixty One"]),
                    rng.uniform(3.2, 6.8), "Af", "Eating Out", note="Apple Pay")
            # Restaurants/bars at weekends
            if wd >= 4 and rng.random() < 0.35:
                add(d, rng.choice(["Cafe de Klos", "Bar Botanique", "Restaurant Floreyn", "Brouwerij 't IJ",
                                   "Sumo Sushi Amsterdam"]), rng.uniform(18, 75), "Af", "Eating Out")
            # Transport: NS commute ~2x/week + occasional OV
            if wd < 5 and rng.random() < 0.4:
                add(d, "NS Groep IZ NS Reizigers", rng.choice([8.40, 8.40, 16.80, 11.20]), "Af", "Transport",
                    note="OV-chipkaart reis")
            if rng.random() < 0.06:
                add(d, "Shell Station A10", rng.uniform(55, 80), "Af", "Transport", note="Brandstof (huurauto/deelauto)")
            if rng.random() < 0.05:
                add(d, "Swapfiets", 19.90, "Af", "Transport", "Incasso", "IC") if d.day == 5 else None
            # Shopping
            if rng.random() < 0.08:
                add(d, rng.choice(["Bol.com B.V.", "HEMA Amsterdam", "Zara Kalverstraat", "Action 2041",
                                   "IKEA Amsterdam"]), rng.uniform(9, 95), "Af", "Shopping",
                    "iDEAL" if rng.random() < 0.5 else "Betaalautomaat")
            # Pharmacy
            if rng.random() < 0.025:
                add(d, "Etos Amsterdam", rng.uniform(5, 28), "Af", "Health & Fitness")
            # Tikkie: paying friends back / getting paid back
            if rng.random() < 0.04:
                friend = rng.choice(["S. de Vries", "M. Jansen", "L. Bakker", "T. Visser"])
                if rng.random() < 0.5:
                    add(d, f"Tikkie {friend}", rng.uniform(8, 45), "Bij", "Transfers", "iDEAL", "ID",
                        fake_iban(rng, "ABNA"), f"Tikkie ID {rng.randint(10**11, 10**12-1)} etentje", ["tikkie"])
                else:
                    add(d, f"Tikkie {friend}", rng.uniform(8, 45), "Af", "Transfers", "iDEAL", "ID",
                        fake_iban(rng, "ABNA"), f"Tikkie ID {rng.randint(10**11, 10**12-1)} terugbetaling", ["tikkie"])
            d += timedelta(days=1)

    # Swapfiets monthly (fix)
    tx[:] = [t for t in tx if t["name"] != "Swapfiets"]
    for y, m in months():
        add(clamp_day(y, m, 5), "Swapfiets", 19.90, "Af", "Transport", "Incasso", "IC",
            fake_iban(rng, "INGB"), "Swapfiets Original abonnement", ["recurring", "subscription"])

    # --- Planted one-offs
    add(date(2025, 11, 28), "Coolblue B.V.", 1299.00, "Af", "Shopping", "iDEAL", "ID",
        "NL86INGB0002445588", "Bestelnr 9182736 LG OLED TV 55 inch", ["big_purchase", "black_friday"])
    add(date(2026, 2, 13), "Bol.com B.V.", 64.95, "Af", "Shopping", "iDEAL", "ID", "",
        "Bestelling 4021339871", ["duplicate_original"])
    add(date(2026, 2, 13), "Bol.com B.V.", 64.95, "Af", "Shopping", "iDEAL", "ID", "",
        "Bestelling 4021339871", ["duplicate"])
    add(date(2026, 3, 2), "Bol.com B.V.", 64.95, "Bij", "Shopping", "Overschrijving", "OV", "",
        "Terugbetaling bestelling 4021339871", ["refund"])
    add(date(2026, 6, 20), "Transavia Airlines", 412.60, "Af", "Other", "iDEAL", "ID", "",
        "Boeking AMS-LIS 2 pers", ["travel"])
    add(date(2026, 5, 15), "Belastingdienst", 312.00, "Bij", "Income", "Overschrijving", "OV",
        "NL86INGB0002445588", "Teruggaaf inkomstenbelasting 2025", ["tax_refund"])

    # sort, compute balance, write
    tx.sort(key=lambda t: (t["date"], t["dir"] == "Af", t["name"]))
    bal = START_BALANCE
    for t in tx:
        bal += t["amount"] if t["dir"] == "Bij" else -t["amount"]
        t["balance"] = round(bal, 2)
    # ING exports are newest-first
    tx.reverse()
    for i, t in enumerate(tx):
        t["row_id"] = i

    out = Path(args.out); out.mkdir(exist_ok=True)
    with open(out / "ing_demo_transactions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_ALL)
        w.writerow(HEADER)
        for t in tx:
            w.writerow([t["date"].strftime("%Y%m%d"), t["name"], MY_IBAN, t["counter"], t["code"], t["dir"],
                        nl_amount(t["amount"]), t["kind"],
                        t["note"] or f"Pasvolgnr: 004 {t['date'].strftime('%d-%m-%Y')}", nl_amount(t["balance"]), ""])

    # ---- Answer key: facts computed from the generated data
    def spend(pred):
        return round(sum(t["amount"] for t in tx if t["dir"] == "Af" and pred(t)), 2)

    by_month_take = defaultdict(float); by_month_groc = defaultdict(float)
    for t in tx:
        k = t["date"].strftime("%Y-%m")
        if "takeaway" in t["tags"]: by_month_take[k] += t["amount"]
        if t["category"] == "Groceries": by_month_groc[k] += t["amount"]
    mk = sorted(by_month_take)
    q1 = sum(by_month_take[k] for k in mk[:3]); q4 = sum(by_month_take[k] for k in mk[-3:])
    income = sum(t["amount"] for t in tx if t["dir"] == "Bij" and t["category"] == "Income")
    saved = spend(lambda t: t["category"] == "Savings")
    subs = sorted({(t["name"]) for t in tx if "subscription" in t["tags"]})
    sub_month = round(sum(t["amount"] for t in tx if "subscription" in t["tags"]
                          and t["date"].strftime("%Y-%m") == "2026-09"), 2)

    facts = [
        {"id": "q01", "question": "How much did I spend on takeaway (Thuisbezorgd) in total over the last 12 months?",
         "answer": round(sum(by_month_take.values()), 2), "type": "number", "tolerance": 1.0},
        {"id": "q02", "question": "Is my takeaway spending going up or down? Compare the first and last 3 months.",
         "answer": {"first_3_months": round(q1, 2), "last_3_months": round(q4, 2),
                    "change_pct": round((q4 - q1) / q1 * 100, 1)}, "type": "trend", "expected_direction": "up"},
        {"id": "q03", "question": "Which subscriptions am I paying for?", "answer": subs, "type": "list"},
        {"id": "q04", "question": "How much do my subscriptions cost per month (September 2026)?",
         "answer": sub_month, "type": "number", "tolerance": 0.5},
        {"id": "q05", "question": "Did any of my subscriptions get more expensive?",
         "answer": {"merchant": "Spotify AB", "old": 11.99, "new": 12.99, "since": "2026-07"}, "type": "fact"},
        {"id": "q06", "question": "Am I paying for something I might not use?",
         "answer": {"merchant": "Basic-Fit Nederland B.V.", "monthly": 34.99, "yearly": round(34.99 * 12, 2)},
         "type": "fact", "note": "Gym membership with no other fitness activity; judgement question"},
        {"id": "q07", "question": "Was I charged twice for anything?",
         "answer": {"merchant": "Bol.com B.V.", "amount": 64.95, "date": "2026-02-13",
                    "refunded_on": "2026-03-02"}, "type": "fact"},
        {"id": "q08", "question": "What was my biggest single purchase?",
         "answer": {"merchant": "Coolblue B.V.", "amount": 1299.00, "date": "2025-11-28"}, "type": "fact"},
        {"id": "q09", "question": "How much did I spend on groceries per month on average?",
         "answer": round(sum(by_month_groc.values()) / len(by_month_groc), 2), "type": "number", "tolerance": 1.0},
        {"id": "q10", "question": "When did my salary change and by how much?",
         "answer": {"old": 3900.00, "new": 4150.00, "since": "2026-04"}, "type": "fact"},
        {"id": "q11", "question": "What percentage of my income did I move to savings?",
         "answer": round(saved / income * 100, 1), "type": "number", "tolerance": 0.5,
         "note": f"savings {saved} / income {round(income, 2)} (salary + tax refund)"},
        {"id": "q12", "question": "How much did I spend on rent in total?",
         "answer": spend(lambda t: t["category"] == "Housing"), "type": "number", "tolerance": 0.01},
        {"id": "q13", "question": "What is my account balance at the end of September 2026?",
         "answer": tx[0]["balance"], "type": "number", "tolerance": 0.01},
        {"id": "q14", "question": "Spending per category for the full year (excluding savings and transfers)",
         "answer": {c: spend(lambda t, c=c: t["category"] == c) for c in CATEGORIES
                    if c not in ("Income", "Savings", "Transfers")}, "type": "table"},
    ]
    key = {
        "generated_with_seed": args.seed,
        "period": [START.isoformat(), END.isoformat()],
        "categories": CATEGORIES,
        "num_transactions": len(tx),
        "labels": [{"row_id": t["row_id"], "date": t["date"].isoformat(), "name": t["name"],
                    "amount": t["amount"], "direction": t["dir"], "category": t["category"], "tags": t["tags"]}
                   for t in tx],
        "questions": facts,
    }
    (out / "ing_demo_answer_key.json").write_text(json.dumps(key, indent=2, ensure_ascii=False))
    print(f"Wrote {len(tx)} transactions -> {out/'ing_demo_transactions.csv'}")
    print(f"Wrote answer key ({len(facts)} questions) -> {out/'ing_demo_answer_key.json'}")


if __name__ == "__main__":
    main()
