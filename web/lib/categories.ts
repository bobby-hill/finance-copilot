// Category set + one-line definitions ("prompt v2" from the eval, which scored best).
export const CATEGORIES: Record<string, string> = {
  Income: "Salary, tax refunds and other income.",
  Housing: "Rent or mortgage.",
  Utilities: "Energy, water, internet/TV and mobile phone bills.",
  Insurance: "Health insurance and other insurance premiums.",
  Subscriptions: "Recurring digital services like video/music streaming and cloud storage.",
  Groceries: "Supermarkets.",
  "Eating Out": "Restaurants, cafes, coffee, bars and food delivery.",
  Transport: "Public transport, fuel, bike or car subscriptions.",
  Shopping: "Retail and online shopping, including refunds of purchases.",
  "Health & Fitness": "Gym memberships, pharmacy and drugstore.",
  Savings: "Transfers to your own savings account.",
  Transfers: "Payments to/from friends (e.g. Tikkie) that are not income.",
  Other: "Anything that fits no other category, e.g. travel.",
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

/** Categories that are not "spending" (money moved, not consumed). */
export const NON_SPENDING = new Set(["Income", "Savings", "Transfers"]);

export const CATEGORY_COLORS: Record<string, string> = {
  Income: "#34d399",
  Housing: "#818cf8",
  Utilities: "#38bdf8",
  Insurance: "#a78bfa",
  Subscriptions: "#f472b6",
  Groceries: "#4ade80",
  "Eating Out": "#fb923c",
  Transport: "#facc15",
  Shopping: "#f87171",
  "Health & Fitness": "#2dd4bf",
  Savings: "#60a5fa",
  Transfers: "#94a3b8",
  Other: "#a1a1aa",
};
