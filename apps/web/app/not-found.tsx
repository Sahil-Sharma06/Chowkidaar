import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="money font-display text-[56px] font-semibold leading-none tracking-tight text-on-surface-variant">404</p>
      <h1 className="mt-4 text-balance font-display text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-pretty text-on-surface-variant">The link may be old, or the address has a typo.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link href="/" className="btn-primary">Go to the home page</Link>
        <Link href="/receipts" className="btn-ghost">Find a receipt</Link>
      </div>
    </div>
  );
}
