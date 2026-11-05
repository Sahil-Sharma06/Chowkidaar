import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Agent Payment Protection",
  description: "Bond-backed refunds for AI agents paying over x402 on Hedera.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-500">
            Testnet only. The bond vault is custodial in this version. Receipts are recorded by the gateway.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
