/**
 * Deterministic finance tools. The LLM never does arithmetic itself: it calls these,
 * and every number it reports comes from here. Pure functions, used by both the
 * chat agent (server) and the dashboard (client).
 */
import { NON_SPENDING } from "./categories";
import type { Transaction } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const month = (d: string) => d.slice(0, 7);

export type Filters = {
  category?: string;
  merchant?: string; // case-insensitive substring of the description
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  direction?: "out" | "in" | "any";
};

export function applyFilters(txs: Transaction[], f: Filters): Transaction[] {
  const m = f.merchant?.toLowerCase();
  const c = f.category?.toLowerCase();
  // Accept both YYYY-MM-DD and YYYY-MM; compare on the same precision.
  const geFrom = (d: string) => !f.from || d.slice(0, f.from.length) >= f.from;
  const leTo = (d: string) => !f.to || d.slice(0, f.to.length) <= f.to;
  return txs.filter(
    (t) =>
      (!c || (t.category ?? "").toLowerCase() === c) &&
      (!m || t.description.toLowerCase().includes(m) || t.note.toLowerCase().includes(m)) &&
      geFrom(t.date) &&
      leTo(t.date) &&
      (f.direction === "in" ? t.amount > 0 : f.direction === "any" ? true : t.amount < 0),
  );
}

export function overview(txs: Transaction[]) {
  const dates = txs.map((t) => t.date).sort();
  const income = txs.filter((t) => t.amount > 0 && t.category === "Income");
  const spending = txs.filter((t) => t.amount < 0 && !NON_SPENDING.has(t.category ?? ""));
  const refunds = txs.filter((t) => t.amount > 0 && t.category && !NON_SPENDING.has(t.category));
  const saved = txs.filter((t) => t.amount < 0 && t.category === "Savings");
  const months = new Set(txs.map((t) => month(t.date))).size || 1;
  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const totalSpending = spending.reduce((s, t) => s - t.amount, 0) - refunds.reduce((s, t) => s + t.amount, 0);
  const totalSaved = saved.reduce((s, t) => s - t.amount, 0);
  return {
    period: { from: dates[0], to: dates[dates.length - 1], months },
    transactions: txs.length,
    total_income: r2(totalIncome),
    total_spending_net_of_refunds: r2(totalSpending),
    total_moved_to_savings: r2(totalSaved),
    savings_rate_pct: totalIncome ? r2((totalSaved / totalIncome) * 100) : null,
    avg_monthly_spending: r2(totalSpending / months),
    categories: [...new Set(txs.map((t) => t.category).filter(Boolean))],
  };
}

export function summarizeSpending(
  txs: Transaction[],
  args: Filters & { group_by?: "category" | "month" | "merchant"; include_non_spending?: boolean },
) {
  let rows = applyFilters(txs, args);
  if (!args.include_non_spending && !args.category && args.direction !== "in")
    rows = rows.filter((t) => !NON_SPENDING.has(t.category ?? ""));
  const by = args.group_by ?? "category";
  const groups = new Map<string, { total: number; count: number }>();
  for (const t of rows) {
    const k = by === "month" ? month(t.date) : by === "merchant" ? t.description : (t.category ?? "Uncategorized");
    const g = groups.get(k) ?? { total: 0, count: 0 };
    g.total += Math.abs(t.amount);
    g.count++;
    groups.set(k, g);
  }
  const out = [...groups.entries()].map(([key, g]) => ({ key, total: r2(g.total), count: g.count }));
  out.sort((a, b) => (by === "month" ? a.key.localeCompare(b.key) : b.total - a.total));
  return {
    group_by: by,
    filters: args,
    grand_total: r2(out.reduce((s, g) => s + g.total, 0)),
    transaction_count: rows.length,
    groups: out.slice(0, 40),
  };
}

export function listTransactions(
  txs: Transaction[],
  args: Filters & { min_amount?: number; sort?: "date" | "amount"; limit?: number },
) {
  let rows = applyFilters(txs, { ...args, direction: args.direction ?? "any" });
  if (args.min_amount) rows = rows.filter((t) => Math.abs(t.amount) >= (args.min_amount as number));
  rows = [...rows].sort((a, b) =>
    args.sort === "amount" ? Math.abs(b.amount) - Math.abs(a.amount) : b.date.localeCompare(a.date),
  );
  const limit = Math.min(args.limit ?? 15, 50);
  return {
    total_matches: rows.length,
    shown: Math.min(limit, rows.length),
    transactions: rows.slice(0, limit).map((t) => ({
      id: t.id,
      date: t.date,
      description: t.description,
      amount: t.amount,
      category: t.category,
    })),
  };
}

/** Merchants charged in >= 3 different months with a stable-ish amount. */
export function findRecurring(txs: Transaction[]) {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of txs.filter((t) => t.amount < 0)) {
    const k = t.description;
    byMerchant.set(k, [...(byMerchant.get(k) ?? []), t]);
  }
  const out = [];
  for (const [merchant, list] of byMerchant) {
    const months = [...new Set(list.map((t) => month(t.date)))].sort();
    if (months.length < 3) continue;
    const [fy, fm] = months[0].split("-").map(Number);
    const [ly, lm] = months[months.length - 1].split("-").map(Number);
    const span = (ly - fy) * 12 + (lm - fm) + 1;
    if (months.length < span * 0.75) continue; // must recur (almost) every month
    const perMonth = months.map((m) => list.filter((t) => month(t.date) === m));
    if (perMonth.some((p) => p.length > 2)) continue; // frequent purchases (groceries), not a subscription
    const amounts = list.sort((a, b) => a.date.localeCompare(b.date)).map((t) => -t.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (spread > mean * 0.35) continue; // amounts vary too much
    const first = amounts[0];
    const latest = amounts[amounts.length - 1];
    const change = list.find((t, i) => i > 0 && -t.amount !== amounts[i - 1]);
    out.push({
      merchant,
      category: list[0].category,
      months_charged: months.length,
      first_month: months[0],
      last_month: months[months.length - 1],
      latest_amount: r2(latest),
      price_change:
        latest !== first ? { from: r2(first), to: r2(latest), first_seen: change ? month(change.date) : null } : null,
      yearly_cost_at_latest_price: r2(latest * 12),
    });
  }
  out.sort((a, b) => b.latest_amount - a.latest_amount);
  return { recurring: out, monthly_total: r2(out.reduce((s, r) => s + r.latest_amount, 0)) };
}

/** Same merchant + amount + date charged more than once, plus any matching refund. */
export function findDuplicates(txs: Transaction[]) {
  const seen = new Map<string, Transaction[]>();
  for (const t of txs.filter((t) => t.amount < 0)) {
    const k = `${t.date}|${t.description}|${t.amount}`;
    seen.set(k, [...(seen.get(k) ?? []), t]);
  }
  const dups = [...seen.values()]
    .filter((l) => l.length > 1)
    .map((l) => {
      const refund = txs.find(
        (t) => t.amount === -l[0].amount && t.description === l[0].description && t.date >= l[0].date,
      );
      return {
        date: l[0].date,
        merchant: l[0].description,
        amount: -l[0].amount,
        times_charged: l.length,
        refunded: refund ? { date: refund.date, amount: refund.amount } : null,
      };
    });
  return { possible_duplicates: dups };
}

// ---------------------------------------------------------------- tool schemas
const filterProps = {
  category: { type: "string", description: "Exact category name" },
  merchant: { type: "string", description: "Case-insensitive part of the merchant/description, e.g. 'thuisbezorgd'" },
  from: { type: "string", description: "Start date YYYY-MM-DD or month YYYY-MM (inclusive)" },
  to: { type: "string", description: "End date YYYY-MM-DD or month YYYY-MM (inclusive)" },
  direction: { type: "string", enum: ["out", "in", "any"], description: "out = money spent (default), in = received" },
};

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "get_overview",
      description: "Period covered, total income, total spending, savings rate, available categories. Call first if unsure.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize_spending",
      description:
        "Sum amounts grouped by category, month or merchant, with optional filters. Excludes Income/Savings/Transfers unless a category is given or include_non_spending is true.",
      parameters: {
        type: "object",
        properties: {
          ...filterProps,
          group_by: { type: "string", enum: ["category", "month", "merchant"] },
          include_non_spending: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_transactions",
      description: "List individual transactions matching filters, newest first or largest first.",
      parameters: {
        type: "object",
        properties: {
          ...filterProps,
          min_amount: { type: "number" },
          sort: { type: "string", enum: ["date", "amount"] },
          limit: { type: "number", description: "max 50, default 15" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_recurring",
      description: "Detect recurring charges (subscriptions, bills, memberships) including price changes and yearly cost.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "find_duplicates",
      description: "Detect possible double charges (same merchant, amount and date) and whether they were refunded.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export function runTool(name: string, args: Record<string, unknown>, txs: Transaction[]): unknown {
  switch (name) {
    case "get_overview":
      return overview(txs);
    case "summarize_spending":
      return summarizeSpending(txs, args as Parameters<typeof summarizeSpending>[1]);
    case "list_transactions":
      return listTransactions(txs, args as Parameters<typeof listTransactions>[1]);
    case "find_recurring":
      return findRecurring(txs);
    case "find_duplicates":
      return findDuplicates(txs);
    default:
      return { error: `Unknown tool ${name}` };
  }
}
