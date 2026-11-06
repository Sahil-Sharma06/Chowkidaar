import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Shell } from "@/components/Shell";
import { TopLoader } from "@/components/TopLoader";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Chowkidaar: spending limits and refunds for AI agents", template: "%s · Chowkidaar" },
  description: "The gateway between autonomous agents and paid APIs on Hedera. If a service fails, the agent is refunded from the merchant's bond.",
};

export const viewport: Viewport = { themeColor: "#f7f7f8", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${outfit.variable}`}>
      <body>
        <a href="#main" className="sr-only rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70]">Skip to content</a>
        <Providers>
          <Nav />
          <TopLoader />
          <main id="main" className="min-h-[calc(100dvh-4rem)]">
            <Shell>{children}</Shell>
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
