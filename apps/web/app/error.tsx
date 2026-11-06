"use client";
import Link from "next/link";

/** Last-resort boundary: a page crashed while rendering. Offer a retry and a way out. */
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center" role="alert">
      <h1 className="text-balance font-display text-2xl font-semibold tracking-tight">This page didn&apos;t load</h1>
      <p className="mt-2 text-pretty text-on-surface-variant">Something on our side stopped it from rendering. Your agents and payments are not affected.</p>
      <div className="mt-8 flex justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">Try again</button>
        <Link href="/" className="btn-ghost">Go to the home page</Link>
      </div>
    </div>
  );
}
