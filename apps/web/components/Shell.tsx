"use client";
import { usePathname } from "next/navigation";

/** The landing page lays out its own full-width sections; every other page gets the standard container. */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/") return <>{children}</>;
  return <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>;
}
