import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger — AI finance copilot",
  description: "Upload a bank export, get it categorized, and ask questions answered with exact numbers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
