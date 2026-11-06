import type { Metadata } from "next";
import { Geist, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Shell } from "@/components/Shell";
import { Cursor } from "@/components/Cursor";
import { Preloader } from "@/components/Preloader";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Chowkidaar — Bond-backed refunds for AI agents paying over x402",
  description: "The gateway between autonomous agents and paid APIs on Hedera. If a service fails, the agent is refunded from the merchant's bond.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${inter.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <Preloader />
          <Cursor />
          <Nav />
          <main className="min-h-[calc(100vh-16rem)] pt-16">
            <Shell>{children}</Shell>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
