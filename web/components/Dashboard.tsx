"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORY_COLORS, CATEGORY_NAMES, NON_SPENDING } from "@/lib/categories";
import { fmt, fmt0, monthLabel } from "@/lib/format";
import { findDuplicates, findRecurring, overview, summarizeSpending } from "@/lib/tools";
import type { Transaction } from "@/lib/types";

type Props = { txs: Transaction[]; onRecategorize: (id: number, category: string) => void };

export default function Dashboard({ txs, onRecategorize }: Props) {
  const ov = useMemo(() => overview(txs), [txs]);
  const byCat = useMemo(() => summarizeSpending(txs, { group_by: "category" }), [txs]);
  const recurring = useMemo(
    () => findRecurring(txs).recurring.filter((r) => !NON_SPENDING.has(r.category ?? "")),
    [txs],
  );
  const dups = useMemo(() => findDuplicates(txs).possible_duplicates, [txs]);
  const monthly = useMemo(() => {
    const m = new Map<string, { month: string; spending: number; income: number }>();
    for (const t of txs) {
      const k = t.date.slice(0, 7);
      const row = m.get(k) ?? { month: k, spending: 0, income: 0 };
      if (t.amount < 0 && !NON_SPENDING.has(t.category ?? "")) row.spending += -t.amount;
      if (t.amount > 0 && t.category === "Income") row.income += t.amount;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({
      ...r,
      label: monthLabel(r.month),
      spending: Math.round(r.spending),
      income: Math.round(r.income),
    }));
  }, [txs]);
  const recurringMonthly = recurring.reduce((s, r) => s + r.latest_amount, 0);
  const priceChanges = recurring.filter((r) => r.price_change && r.price_change.to > r.price_change.from);

  return (
    <div className="min-w-0 space-y-6">
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Income" value={fmt0(ov.total_income)} sub={`${ov.period.months} months`} accent="#34d399" />
        <Kpi label="Spending" value={fmt0(ov.total_spending_net_of_refunds)} sub={`${fmt0(ov.avg_monthly_spending)} / month`} accent="#fb923c" />
        <Kpi label="Savings rate" value={ov.savings_rate_pct != null ? `${ov.savings_rate_pct.toFixed(1)}%` : "–"} sub={`${fmt0(ov.total_moved_to_savings)} saved`} accent="#60a5fa" />
        <Kpi label="Recurring" value={fmt0(recurringMonthly)} sub={`${recurring.length} charges / month`} accent="#f472b6" />
      </section>

      {/* Insights */}
      {(priceChanges.length > 0 || dups.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          {priceChanges.map((r) => (
            <Insight key={r.merchant} tone="amber" title={`${r.merchant} got more expensive`}>
              {fmt(r.price_change!.from)} → {fmt(r.price_change!.to)} since {r.price_change!.first_seen}
            </Insight>
          ))}
          {dups.map((d) => (
            <Insight key={d.date + d.merchant} tone={d.refunded ? "slate" : "red"} title={`Charged ${d.times_charged}× at ${d.merchant}`}>
              {fmt(d.amount)} on {d.date}
              {d.refunded ? ` · refunded ${d.refunded.date}` : " · not refunded"}
            </Insight>
          ))}
        </section>
      )}

      {/* Monthly chart */}
      <section className="card p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-medium">Income vs spending</h2>
          <div className="flex gap-4 text-xs text-ink-400">
            <Legend color="#34d399" label="Income" />
            <Legend color="#fb923c" label="Spending" />
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} barGap={3}>
              <CartesianGrid vertical={false} stroke="#1f2732" />
              <XAxis dataKey="label" tick={{ fill: "#7d8a9c", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#7d8a9c", fontSize: 12 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `€${v / 1000}k`} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,.03)" }}
                contentStyle={{ background: "#10151c", border: "1px solid #2c3644", borderRadius: 10, fontSize: 13 }}
                formatter={(v: number) => fmt0(v)}
              />
              <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} />
              <Bar dataKey="spending" fill="#fb923c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Categories */}
        <section className="card p-5">
          <h2 className="mb-4 font-medium">Where the money went</h2>
          <ul className="space-y-3">
            {byCat.groups.map((g) => (
              <li key={g.key}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[g.key] ?? "#a1a1aa" }} />
                    {g.key}
                  </span>
                  <span className="num text-ink-300">
                    {fmt0(g.total)} <span className="text-ink-600">· {((g.total / byCat.grand_total) * 100).toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(g.total / byCat.groups[0].total) * 100}%`, background: CATEGORY_COLORS[g.key] ?? "#a1a1aa" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Recurring */}
        <section className="card p-5">
          <h2 className="mb-4 font-medium">Recurring charges</h2>
          <ul className="divide-y divide-ink-700/70">
            {recurring.map((r) => (
              <li key={r.merchant} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{r.merchant}</p>
                  <p className="text-xs text-ink-400">
                    {r.category} · {r.months_charged} months
                  </p>
                </div>
                <div className="text-right">
                  <p className="num">{fmt(r.latest_amount)}</p>
                  {r.price_change && r.price_change.to > r.price_change.from && (
                    <p className="num text-xs text-amber-400">was {fmt(r.price_change.from)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Transactions txs={txs} onRecategorize={onRecategorize} />
    </div>
  );
}

function Transactions({ txs, onRecategorize }: Props) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [limit, setLimit] = useState(25);
  const rows = useMemo(() => {
    const s = q.toLowerCase();
    return txs.filter(
      (t) => (!cat || t.category === cat) && (!s || t.description.toLowerCase().includes(s) || t.note.toLowerCase().includes(s)),
    );
  }, [txs, q, cat]);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <h2 className="font-medium">
          Transactions <span className="num text-sm text-ink-400">({rows.length})</span>
        </h2>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-40 rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm outline-none focus:border-mint-400/60"
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm outline-none"
          >
            <option value="">All categories</option>
            {CATEGORY_NAMES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.id} className="border-t border-ink-700/60 hover:bg-ink-800/40">
                <td className="num whitespace-nowrap px-5 py-2.5 text-ink-400">{t.date}</td>
                <td className="max-w-[280px] truncate px-2 py-2.5" title={t.note}>
                  {t.description}
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={t.category}
                    onChange={(e) => onRecategorize(t.id, e.target.value)}
                    title="Change category"
                    className="cursor-pointer rounded-full border-0 px-2.5 py-0.5 text-xs outline-none"
                    style={{
                      background: `${CATEGORY_COLORS[t.category ?? ""] ?? "#a1a1aa"}22`,
                      color: CATEGORY_COLORS[t.category ?? ""] ?? "#a1a1aa",
                    }}
                  >
                    {CATEGORY_NAMES.map((c) => (
                      <option key={c} className="bg-ink-900 text-ink-100">
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`num whitespace-nowrap px-5 py-2.5 text-right ${t.amount > 0 ? "text-emerald-400" : ""}`}>
                  {t.amount > 0 ? "+" : ""}
                  {fmt(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button onClick={() => setLimit(limit + 50)} className="w-full border-t border-ink-700/60 py-3 text-sm text-ink-400 hover:text-ink-100">
          Show more
        </button>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="num mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="num mt-1 text-xs text-ink-400">{sub}</p>
    </div>
  );
}

function Insight({ tone, title, children }: { tone: "amber" | "red" | "slate"; title: string; children: React.ReactNode }) {
  const c = { amber: "border-amber-400/30 bg-amber-400/5 text-amber-300", red: "border-red-400/30 bg-red-400/5 text-red-300", slate: "border-ink-600 bg-ink-850 text-ink-300" }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${c}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="num mt-0.5 text-xs opacity-80">{children}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
