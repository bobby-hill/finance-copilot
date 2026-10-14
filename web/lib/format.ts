const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const fmt = (n: number) => eur.format(n);
export const fmt0 = (n: number) => eur0.format(n);
export const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
