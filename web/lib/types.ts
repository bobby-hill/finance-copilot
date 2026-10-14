export type Transaction = {
  id: number;
  date: string; // YYYY-MM-DD
  description: string; // merchant / counterparty name
  amount: number; // negative = money out, positive = money in
  note: string; // free-text details from the bank
  counterparty: string; // IBAN if known
  category?: string;
};

export type ToolTrace = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  ms: number;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  trace?: ToolTrace[];
};
