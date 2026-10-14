#!/usr/bin/env python3
"""
Anonymize a bank-statement CSV (ING, Rabobank, ABN AMRO, bunq, Revolut, generic) so it can be
used as demo/eval data. Runs 100% locally, standard library only.

What it does
  - IBANs / account numbers   -> consistent fake IBANs (same real IBAN -> same fake one)
  - Private persons' names    -> "Person 01", "Person 02", ... (businesses are kept, since they are
                                 what the app categorizes; see --keep / --redact to override)
  - Free-text details         -> scrubs IBANs, card/terminal/transaction IDs, mandate & creditor IDs,
                                 payment references, e-mails, phone numbers, Dutch postcodes,
                                 street addresses, "Naam: ..." fields
  - Your own words            -> --redact "Niko" --redact "Kerkstraat" (case-insensitive, everywhere)
  - Optional                  -> --scale-amounts 0.87 (multiplies amounts AND balances, keeps them
                                 consistent), --shift-days -30 (moves all dates)

The mapping real->fake is NOT saved (that would undo the anonymization) unless --save-mapping.
Fakes are derived with a random secret per run; pass --seed to make runs reproducible.

ALWAYS review the output before sharing: the script prints the names it kept so you can check them.

Usage
  python3 anonymize_csv.py my_export.csv                       # -> my_export.anon.csv
  python3 anonymize_csv.py my_export.csv -o demo.csv --redact "Niko" --redact "Papadopoulos"
  python3 anonymize_csv.py my_export.csv --scale-amounts 0.9 --shift-days -14
"""
import argparse, csv, hashlib, hmac, io, re, secrets, sys
from datetime import datetime, timedelta
from pathlib import Path

# ------------------------------------------------------------------ patterns
IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}[A-Z]{4}\d{6,20}\b|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+31|0031|0)\s?(?:6|[1-9]\d)[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)")
POSTCODE_RE = re.compile(r"\b[1-9]\d{3}\s?[A-Z]{2}\b")
STREET_RE = re.compile(
    r"\b[A-Z][a-zà-ÿ]+(?:straat|laan|weg|plein|gracht|kade|singel|dijk|steeg|hof|park|dreef|plantsoen|markt)\s+\d+[a-zA-Z]?\b",
)
# labeled IDs inside ING/Rabo/ABN details: replace the value, keep the label
LABELED_ID_RE = re.compile(
    r"(?P<label>Pasvolgnr|Transactie|Term|Kenmerk|Machtiging ID|Incassant ID|Mandaat ID|Mandaat|Creditor ID|"
    r"Betalingskenm\.?|Referentie|Ref\.?|Tikkie ID|Bestelnr|Bestelling|Order|Factuurnummer|Klantnummer|"
    r"Contractnummer|Polisnummer|Kaartnummer|Card)\s*[:.]?\s*(?P<value>(?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{2,})",
    re.I,
)
NAME_FIELD_RE = re.compile(r"(?P<label>Naam|Name|Omschrijving van|Ten name van)\s*:\s*(?P<value>[^:]+?)(?=\s+[A-Z][a-z]+\s*:|$)")
LONG_NUMBER_RE = re.compile(r"(?<![\w,.-])\d{9,}(?![\w,.-])")  # stray account/reference numbers

BUSINESS_HINTS = re.compile(
    r"\b(B\.?V\.?|N\.?V\.?|V\.?O\.?F\.?|\w*stichting|\w*vereniging|\w*bedrijf|Gemeente|Belastingdienst|Ltd|LLC|Inc|GmbH|AB|SA|SAS|S\.?L\.?|"
    r"Holding|Group|Groep|Bank|Verzekering\w*|Zorg\w*|Energie|Services?|Shop|Store|Station|Restaurant|Cafe|Café|"
    r"Bar|Hotel|Apotheek|Payments?|Payment|Card|Beheer|Airlines?|Spaarrekening|Rekening|Nederland|Netherlands|"
    r"Amsterdam|Rotterdam|Utrecht|Company|Club|Insurance|Mortgage|Checking|Savings|Transfer|"
    r"Mollie|Adyen|PayPal|Stripe|Klarna|iDEAL|Tikkie|Coffee|Online|Supermarkt|Markt)\b"
    r"|\.(com|nl|de|eu|io)\b|\d{3,}",
    re.I,
)
ALL_CAPS_RE = re.compile(r"^[A-Z0-9&'./ -]{4,}$")  # "ALBERT HEIJN", "LIDL AMSTERDAM" (case-sensitive)
PERSON_HINTS = re.compile(r"^(?:(?:Dhr|Hr|Mw|Mevr|Mr|Mrs|Ms|Fam)\.?\s+)?(?:[A-Z]\.\s?){1,4}(?:(?:van|de|der|den|ten|ter|het|'t)\s+)*[A-Z][a-zà-ÿ'-]+")

COLUMN_ROLES = {
    "name": re.compile(r"naam|name|tegenpartij|counterparty|payee|beneficiary|description|omschrijving$|merchant", re.I),
    "iban": re.compile(r"rekening|iban|account|tegenrekening|bban", re.I),
    "amount": re.compile(r"bedrag|amount|saldo|balance|value", re.I),
    "date": re.compile(r"datum|date|boekdatum|rentedatum", re.I),
}


# ------------------------------------------------------------------ helpers
class Faker:
    def __init__(self, secret: bytes):
        self.secret = secret
        self.people: dict[str, str] = {}
        self.ibans: dict[str, str] = {}
        self.ids: dict[str, str] = {}
        self.counts = {"iban": 0, "person": 0, "id": 0, "email": 0, "phone": 0, "postcode": 0, "street": 0, "custom": 0}

    def _h(self, kind: str, value: str, n: int) -> str:
        return hmac.new(self.secret, f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()[:n]

    def iban(self, real: str) -> str:
        key = real.replace(" ", "").upper()
        if key not in self.ibans:
            digits = str(int(self._h("iban", key, 12), 16))[:10].rjust(10, "0")
            self.ibans[key] = f"{key[:2]}00ANON{digits}"
        self.counts["iban"] += 1
        return self.ibans[key]

    def person(self, real: str) -> str:
        key = re.sub(r"\s+", " ", real.strip().lower())
        if key not in self.people:
            self.people[key] = f"Person {len(self.people) + 1:02d}"
        self.counts["person"] += 1
        return self.people[key]

    def ident(self, real: str) -> str:
        if real not in self.ids:
            self.ids[real] = "X" * min(len(real), 4) + self._h("id", real, 6).upper()
        self.counts["id"] += 1
        return self.ids[real]


def looks_like_person(name: str, transfer_context: bool = True) -> bool:
    """Initials/titles ("J. de Vries", "Dhr. Jansen") always count. Plain capitalized words
    ("Maria van den Berg") only count in a transfer context (row has a counterparty IBAN),
    otherwise card payments like "Platinum Card" would be flagged."""
    n = name.strip()
    if not n or len(n) > 60:
        return False
    if BUSINESS_HINTS.search(n):
        return False
    if ALL_CAPS_RE.match(n):
        # banks often upper-case private names on transfers: judge the title-cased form instead
        if not transfer_context or len(n.split()) > 5:
            return False
        n = re.sub(r"\b([A-Z])\b(?!\.)", r"\1.", n.title())  # "J Jansen" -> "J. Jansen"
    if PERSON_HINTS.match(n):
        return True
    if not transfer_context:
        return False
    # "Jan Jansen", "Maria de Vries": 2-4 capitalized words, no business hints
    words = n.split()
    particles = {"van", "de", "der", "den", "ten", "ter", "het", "'t", "la", "le", "du", "di", "da"}
    caps = [w for w in words if w.lower() not in particles]
    return 2 <= len(words) <= 5 and all(re.fullmatch(r"[A-Z][a-zà-ÿ'-]+\.?", w) for w in caps)


def scrub_text(s: str, fk: Faker, redact: list[re.Pattern], keep: set[str]) -> str:
    if not s:
        return s
    for pat in redact:
        s, k = pat.subn("[REDACTED]", s)
        fk.counts["custom"] += k
    s = IBAN_RE.sub(lambda m: fk.iban(m.group(0)), s)
    s, k = EMAIL_RE.subn("user@example.com", s); fk.counts["email"] += k
    s, k = PHONE_RE.subn("06-00000000", s); fk.counts["phone"] += k
    s, k = STREET_RE.subn("Voorbeeldstraat 1", s); fk.counts["street"] += k
    s, k = POSTCODE_RE.subn("1000 AA", s); fk.counts["postcode"] += k
    s = LABELED_ID_RE.sub(lambda m: f"{m.group('label')}: {fk.ident(m.group('value'))}", s)

    def name_field(m):
        v = m.group("value").strip()
        if v.lower() in keep or not looks_like_person(v):
            return m.group(0)
        return f"{m.group('label')}: {fk.person(v)}"

    s = NAME_FIELD_RE.sub(name_field, s)
    s = LONG_NUMBER_RE.sub(lambda m: fk.ident(m.group(0)), s)
    return s


def detect_number_style(values: list[str]) -> str:
    for v in values:
        v = v.strip()
        if re.search(r",\d{2}$", v):
            return "nl"
        if re.search(r"\.\d{2}$", v):
            return "en"
    return "en"


def parse_num(v: str, style: str):
    s = v.strip().replace("€", "").replace(" ", "")
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".") if style == "nl" else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def fmt_num(x: float, original: str, style: str) -> str:
    sign = "+" if original.strip().startswith("+") and x >= 0 else ""
    thousands = ("." in original and style == "nl") or ("," in original and style == "en")
    body = f"{abs(x):,.2f}" if thousands else f"{abs(x):.2f}"
    if style == "nl":
        body = body.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if x < 0 else sign}{body}"


DATE_FORMATS = ["%Y%m%d", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S"]


def shift_date(v: str, days: int) -> str:
    for f in DATE_FORMATS:
        try:
            return (datetime.strptime(v.strip(), f) + timedelta(days=days)).strftime(f)
        except ValueError:
            continue
    return v


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("-o", "--output")
    ap.add_argument("--redact", action="append", default=[], help="word/phrase to remove everywhere (repeatable)")
    ap.add_argument("--keep", action="append", default=[], help="name to never treat as a person (repeatable)")
    ap.add_argument("--person", action="append", default=[], help="name to always treat as a person (repeatable)")
    ap.add_argument("--scale-amounts", type=float, help="multiply all amounts and balances, e.g. 0.87")
    ap.add_argument("--shift-days", type=int, default=0, help="shift all dates by N days")
    ap.add_argument("--seed", help="make fake values reproducible across runs")
    ap.add_argument("--save-mapping", help="write real->fake mapping to this file (keep it private!)")
    args = ap.parse_args()

    src = Path(args.input)
    raw = src.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace") if raw[:3] == b"\xef\xbb\xbf" else raw.decode("utf-8", errors="replace")
    first = text.split("\n", 1)[0]
    delim = max([";", ",", "\t"], key=first.count)
    quoting = csv.QUOTE_ALL if first.startswith('"') else csv.QUOTE_MINIMAL
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        sys.exit("Empty file")
    header, body = rows[0], rows[1:]
    has_header = not any(re.fullmatch(r"[-+]?[\d.,]+", h.strip() or "x") for h in header)
    if not has_header:
        body, header = rows, [f"col{i}" for i in range(len(rows[0]))]

    roles = {}
    for i, h in enumerate(header):
        for role, pat in COLUMN_ROLES.items():
            if pat.search(h) and i not in roles:
                roles[i] = role
    style = detect_number_style([r[i] for r in body[:200] for i, ro in roles.items() if ro == "amount" and i < len(r)])

    own_col = None  # the account holder's own IBAN column (same value on every row) is not a counterparty
    for i, ro in roles.items():
        if ro == "iban":
            vals = {r[i] for r in body if i < len(r) and r[i]}
            if len(vals) == 1:
                own_col = i
    fk = Faker(args.seed.encode() if args.seed else secrets.token_bytes(32))
    redact = [re.compile(re.escape(w), re.I) for w in args.redact if w.strip()]
    keep = {k.lower() for k in args.keep}
    force_person = {p.lower() for p in args.person}

    def flexible(name: str) -> re.Pattern:
        # "J. de Vries" also matches "J DE VRIES", "j.de  vries", "Hr J. de Vries"
        tokens = [re.escape(t.strip(".")) for t in name.split() if t.strip(".")]
        return re.compile(r"\b" + r"[.\s]*".join(tokens) + r"\b\.?", re.I)

    person_patterns = [(flexible(p), p) for p in args.person if p.strip()]
    kept_names: dict[str, int] = {}

    out_rows = []
    for r in body:
        r = list(r)
        transfer = any(roles.get(i) == "iban" and IBAN_RE.search(v or "") and i != own_col for i, v in enumerate(r)) \
            or any("Naam:" in (v or "") for v in r)
        for i, v in enumerate(r):
            role = roles.get(i)
            if person_patterns and role not in ("amount", "date"):
                for pat, real in person_patterns:
                    v = pat.sub(lambda m, real=real: fk.person(real), v)
                r[i] = v
            if role == "amount" and args.scale_amounts:
                x = parse_num(v, style)
                if x is not None:
                    r[i] = fmt_num(round(x * args.scale_amounts, 2), v, style)
                continue
            if role == "date" and args.shift_days:
                r[i] = shift_date(v, args.shift_days)
                continue
            if role == "iban" and IBAN_RE.fullmatch(v.strip()):
                r[i] = fk.iban(v.strip())
                continue
            if role == "name":
                vv = v.strip()
                if vv and vv.lower() not in keep and (vv.lower() in force_person or looks_like_person(vv, transfer)):
                    r[i] = fk.person(vv)
                    continue
                # "Tikkie J. Jansen" / "Betaalverzoek van Jan Jansen": keep the prefix, anonymize the person
                m = re.match(r"^(Tikkie|Betaalverzoek(?: van)?|Overboeking(?: van| naar)?|Van|Naar)\s+(.+)$", vv, re.I)
                if m and looks_like_person(m.group(2), True) and m.group(2).lower() not in keep:
                    r[i] = f"{m.group(1)} {fk.person(m.group(2))}"
                    continue
                if vv:
                    kept_names[vv] = kept_names.get(vv, 0) + 1
            r[i] = scrub_text(v, fk, redact, keep)
        out_rows.append(r)

    dst = Path(args.output) if args.output else src.with_suffix(".anon.csv")
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=delim, quoting=quoting)
        if has_header:
            w.writerow(header)
        w.writerows(out_rows)

    if args.save_mapping:
        import json
        Path(args.save_mapping).write_text(json.dumps({"people": fk.people, "ibans": fk.ibans}, indent=2))

    print(f"Wrote {dst}  ({len(out_rows)} rows, delimiter {delim!r}, numbers {style})")
    print("Columns:", ", ".join(f"{header[i]}={ro}" for i, ro in sorted(roles.items())) or "none detected")
    print("Replaced:", ", ".join(f"{k} {v}" for k, v in fk.counts.items() if v) or "nothing")
    print(f"Distinct people anonymized: {len(fk.people)}   distinct IBANs: {len(fk.ibans)}")
    if fk.people:
        print("\nAnonymized as people. If a business is in here, rerun with --keep \"Name\":")
        for real, fake in sorted(fk.people.items(), key=lambda kv: kv[1]):
            print(f"  {fake}  <-  {real}")
    if kept_names:
        print("\nKept as-is (treated as businesses). CHECK this list for anything personal and rerun with "
              "--person \"Name\" or --redact \"word\":")
        for n, c in sorted(kept_names.items(), key=lambda kv: -kv[1])[:60]:
            print(f"  {c:>4}x  {n}")
        if len(kept_names) > 60:
            print(f"  ... and {len(kept_names) - 60} more")


if __name__ == "__main__":
    main()
