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
  Transfers:
    "Payments to/from friends (e.g. Tikkie) and money moved between your own accounts (top-ups, currency exchanges). Not income.",
  Other: "Anything that fits no other category, e.g. travel.",
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

/** Categories that are not "spending" (money moved, not consumed). */
export const NON_SPENDING = new Set(["Income", "Savings", "Transfers"]);

// Mid-tone, slightly desaturated hues: legible on both the dark and light surfaces.
export const CATEGORY_COLORS: Record<string, string> = {
  Income: "#6c7ae0",
  Housing: "#4f8fd6",
  Utilities: "#3fa7b8",
  Insurance: "#8a8fb8",
  Subscriptions: "#b46ad0",
  Groceries: "#4fa874",
  "Eating Out": "#d08a3c",
  Transport: "#a3a53d",
  Shopping: "#d0647f",
  "Health & Fitness": "#3fb09a",
  Savings: "#5a9be6",
  Transfers: "#8a8a93",
  Other: "#9a9488",
};
