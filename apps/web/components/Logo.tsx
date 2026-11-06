import { cx } from "@/lib/ui";

/**
 * The mark: a gate. Chowkidaar is the watchman at the gateway between agents and the APIs they pay;
 * the arch is the gateway and the point of light inside it is a payment passing through, watched.
 * One solid shape so it holds up at 16px.
 */
export function Logo({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path fillRule="evenodd" fill="var(--color-on-surface)" d="M4.5 31 V14.5 A11.5 11.5 0 0 1 27.5 14.5 V31 H21 V16 A5 5 0 0 0 11 16 V31 Z" />
      <circle cx="16" cy="23.5" r="2.7" fill="var(--color-brand)" />
    </svg>
  );
}
