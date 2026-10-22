import type { Transaction } from "./types";

/** RFC-4180-ish CSV parser: handles quotes, escaped quotes and newlines inside quotes. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** "1.299,00" (Dutch) or "1,299.00" / "1299.00" (English) -> 1299 */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[€$\s]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // DD-MM-YYYY (European)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}

export type ParseResult = { format: string; transactions: Transaction[] };

export function parseBankCsv(text: string): ParseResult {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const [header, ...rows] = parseCsvRows(text.replace(/^﻿/, ""), delimiter);
  if (!header) throw new Error("Empty file");
  const h = header.map((x) => x.trim());
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));

  // --- ING (NL)
  if (h.includes("Naam / Omschrijving") && h.includes("Af Bij")) {
    const i = {
      date: h.indexOf("Datum"),
      name: h.indexOf("Naam / Omschrijving"),
      counter: h.indexOf("Tegenrekening"),
      dir: h.indexOf("Af Bij"),
      amount: h.findIndex((x) => x.startsWith("Bedrag")),
      note: h.indexOf("Mededelingen"),
      balance: h.indexOf("Saldo na mutatie"),
    };
    return {
      format: "ING",
      transactions: rows.map((r, id) => {
        const amt = parseAmount(r[i.amount] ?? "0");
        return {
          id,
          date: parseDate(r[i.date] ?? ""),
          description: (r[i.name] ?? "").trim(),
          amount: r[i.dir]?.trim() === "Af" ? -amt : amt,
          note: (r[i.note] ?? "").trim(),
          counterparty: (r[i.counter] ?? "").trim(),
          balance: i.balance >= 0 && (r[i.balance] ?? "").trim() ? parseAmount(r[i.balance]) : undefined,
        };
      }),
    };
  }

  // --- Revolut: Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
  if (h.includes("Started Date") && h.includes("State") && h.includes("Amount")) {
    const i = {
      type: h.indexOf("Type"),
      product: h.indexOf("Product"),
      started: h.indexOf("Started Date"),
      completed: h.indexOf("Completed Date"),
      desc: h.indexOf("Description"),
      amount: h.indexOf("Amount"),
      fee: h.indexOf("Fee"),
      currency: h.indexOf("Currency"),
      state: h.indexOf("State"),
      balance: h.indexOf("Balance"),
    };
    const kept = rows.filter((r) => {
      const st = (r[i.state] ?? "").trim().toUpperCase();
      return st === "COMPLETED" || st === ""; // skip PENDING, REVERTED, DECLINED, FAILED
    });
    return {
      format: "Revolut",
      transactions: kept.map((r, id) => {
        const fee = i.fee >= 0 ? parseAmount(r[i.fee] ?? "0") : 0;
        const amount = Math.round((parseAmount(r[i.amount] ?? "0") - Math.abs(fee)) * 100) / 100;
        const cur = (r[i.currency] ?? "").trim();
        const type = (r[i.type] ?? "").trim();
        return {
          id,
          date: parseDate(r[i.completed] || r[i.started] || ""),
          description: (r[i.desc] ?? "").trim(),
          amount,
          note: [type, (r[i.product] ?? "").trim(), cur && cur !== "EUR" ? `currency ${cur}` : ""]
            .filter(Boolean)
            .join(" · "),
          counterparty: "",
          balance: i.balance >= 0 && (r[i.balance] ?? "").trim() ? parseAmount(r[i.balance]) : undefined,
        };
      }),
    };
  }

  // --- Generic (incl. the Kaggle dataset: Date, Description, Amount, Transaction Type)
  const iDate = col(/(^|\s)(date|datum)\b|transaction date|booking date|boekdatum/i);
  const iDesc = col(/(description|omschrijving|naam|name|merchant|payee)/i);
  const iAmt = col(/(amount|bedrag)/i);
  const iType = col(/(transaction type|af bij|debit\/credit|type)/i);
  const iNote = col(/(note|memo|mededelingen|details)/i);
  if (iDate < 0 || iDesc < 0 || iAmt < 0)
    throw new Error(`Unrecognized CSV format. Columns found: ${h.join(", ")}`);
  return {
    format: iType >= 0 && /transaction type/i.test(h[iType]) ? "Kaggle/generic" : "generic",
    transactions: rows.map((r, id) => {
      let amt = parseAmount(r[iAmt] ?? "0");
      const t = (r[iType] ?? "").toLowerCase();
      if (iType >= 0 && amt > 0 && /(debit|af|out)/.test(t)) amt = -amt;
      return {
        id,
        date: parseDate(r[iDate] ?? ""),
        description: (r[iDesc] ?? "").trim(),
        amount: amt,
        note: iNote >= 0 ? (r[iNote] ?? "").trim() : "",
        counterparty: "",
      };
    }),
  };
}
