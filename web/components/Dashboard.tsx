"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
        <Kpi label="Income" value={fmt0(ov.total_income)} sub={`${ov.period.months} months`} />
        <Kpi label="Spending" value={fmt0(ov.total_spending_net_of_refunds)} sub={`${fmt0(ov.avg_monthly_spending)} / month`} />
        <Kpi label="Savings rate" value={ov.savings_rate_pct != null ? `${ov.savings_rate_pct.toFixed(1)}%` : "–"} sub={`${fmt0(ov.total_moved_to_savings)} saved`} />
        <Kpi label="Recurring" value={fmt0(recurringMonthly)} sub={`${recurring.length} charges / month`} inverted />
      </section>

      {/* Insights */}
      {(priceChanges.length > 0 || dups.length > 0) && (
        <section className="grid gap-3 md:grid-cols-2">
          {priceChanges.map((r) => (
            <Insight key={r.merchant} tone="ink" title={`${r.merchant} got more expensive`}>
              {fmt(r.price_change!.from)} → {fmt(r.price_change!.to)} since {r.price_change!.first_seen}
            </Insight>
          ))}
          {dups.map((d) => (
            <Insight key={d.date + d.merchant} tone={d.refunded ? "soft" : "ink"} title={`Charged ${d.times_charged}× at ${d.merchant}`}>
              {fmt(d.amount)} on {d.date}
              {d.refunded ? ` · refunded ${d.refunded.date}` : " · not refunded"}
            </Insight>
          ))}
        </section>
      )}

      {/* Monthly chart */}
      <section className="card p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Income vs spending</h2>
          <div className="flex gap-4 text-sm">
            <Legend color="var(--accent)" label="Income" />
            <Legend color="var(--chart-2)" label="Spending" />
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} barGap={3}>
              <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `€${v / 1000}k`} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, color: "var(--ink)" }}
                itemStyle={{ color: "var(--ink)" }}
                labelStyle={{ color: "var(--muted)", fontWeight: 500 }}
                formatter={(v: number) => fmt0(v)}
              />
              <Bar dataKey="income" fill="var(--accent)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="spending" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Categories */}
        <section className="card p-6">
          <h2 className="mb-6 text-lg font-semibold tracking-tight">Where the money went</h2>
          <ul className="space-y-4">
            {byCat.groups.map((g) => (
              <li key={g.key}>
                <div className="mb-1.5 flex justify-between text-[15px]">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[g.key] ?? "#8a8a93" }} />
                    {g.key}
                  </span>
                  <span className="num font-semibold">
                    {fmt0(g.total)} <span className="font-normal text-muted">· {((g.total / byCat.grand_total) * 100).toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full"
                    style={{ width: `${(g.total / byCat.groups[0].total) * 100}%`, background: CATEGORY_COLORS[g.key] ?? "#8a8a93" }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Recurring */}
        <section className="card p-6">
          <h2 className="mb-6 text-lg font-semibold tracking-tight">Recurring charges</h2>
          <ul>
            {recurring.map((r) => (
              <li key={r.merchant} className="flex items-center justify-between gap-3 px-3 py-3 text-[15px] even:bg-surface-2/50 rounded-lg">
                <div className="min-w-0">
                  <p className="truncate">{r.merchant}</p>
                  <p className="text-sm text-muted">
                    {r.category} · {r.months_charged} months
                  </p>
                </div>
                <div className="text-right">
                  <p className="num font-semibold">{fmt(r.latest_amount)}</p>
                  {r.price_change && r.price_change.to > r.price_change.from && (
                    <p className="num text-sm font-semibold text-muted">was {fmt(r.price_change.from)}</p>
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
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Transactions <span className="num text-base font-semibold text-muted">({rows.length})</span>
        </h2>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="field w-40 text-[15px]"
          />
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="field text-[15px]"
          >
            <option value="">All categories</option>
            {CATEGORY_NAMES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.id} className="hover:bg-surface-2">
                <td className="num whitespace-nowrap px-6 py-2.5 text-muted">{t.date}</td>
                <td className="max-w-[280px] truncate px-2 py-2.5" title={t.note}>
                  {t.description}
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={t.category}
                    onChange={(e) => onRecategorize(t.id, e.target.value)}
                    title="Change category"
                    className="cursor-pointer rounded-md border-0 px-2 py-1 text-sm font-medium outline-none"
                    style={{
                      background: `${CATEGORY_COLORS[t.category ?? ""] ?? "#8a8a93"}26`,
                      color: CATEGORY_COLORS[t.category ?? ""] ?? "#8a8a93",
                    }}
                  >
                    {CATEGORY_NAMES.map((c) => (
                      <option key={c} className="bg-surface text-ink">
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`num whitespace-nowrap px-6 py-2.5 text-right ${t.amount > 0 ? "font-semibold" : ""}`}>
                  {t.amount > 0 ? "+" : ""}
                  {fmt(t.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button onClick={() => setLimit(limit + 50)} className="link w-full py-4 text-[15px]">
          Show more
        </button>
      )}
    </section>
  );
}

function Kpi({ label, value, sub, inverted }: { label: string; value: string; sub: string; inverted?: boolean }) {
  return (
    <div className={`rounded-xl p-5 ${inverted ? "bg-ink text-bg" : "card"}`}>
      <p className={`text-[13px] font-medium ${inverted ? "opacity-70" : "text-muted"}`}>{label}</p>
      <p className="num mt-3 text-[clamp(1.75rem,2.8vw,2.6rem)] font-semibold leading-none tracking-tighter">{value}</p>
      <p className={`num mt-2 text-[14px] ${inverted ? "opacity-70" : "text-muted"}`}>{sub}</p>
    </div>
  );
}

function Insight({ tone, title, children }: { tone: "ink" | "soft"; title: string; children: React.ReactNode }) {
  const c = { ink: "bg-ink text-bg", soft: "bg-surface-2 text-ink border border-line" }[tone];
  return (
    <div className={`rounded-xl px-5 py-4 ${c}`}>
      <p className="text-[16px] font-semibold leading-snug">{title}</p>
      <p className="num mt-1 text-[15px]">{children}</p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
