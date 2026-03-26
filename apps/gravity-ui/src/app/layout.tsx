import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gravity Search — Antigravity",
  description: "Conversational financial search engine. Search SEC filings, earnings transcripts, and market intelligence with AI-powered citations.",
  openGraph: {
    title: "Gravity Search",
    description: "AI-powered financial research engine",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090b14] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
