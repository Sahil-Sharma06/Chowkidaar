"use client";
import { usePathname } from "next/navigation";

/**
 * The landing page and the console lay themselves out edge to edge (the console is a full-height
 * workspace); every other page gets the standard container.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/" || path === "/console") return <>{children}</>;
  return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">{children}</div>;
}
