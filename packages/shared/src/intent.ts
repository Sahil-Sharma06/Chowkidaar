/**
 * Matches a free-text request to merchants using only what the merchants declared about
 * themselves (category, keywords, name, slug). No fixed list of services lives in the code.
 */
export type Describable = { name: string; slug: string; category: string; keywords: string[] };

const STOP = new Set(["the", "and", "for", "with", "get", "give", "please", "some", "can", "you", "want", "need", "now", "right", "latest", "current"]);

/** Lowercase word tokens with a crude plural strip, minus filler words. */
export function tokens(text: string): string[] {
  return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem)));
}
const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);

/** Which of the merchant's own words appear in the request. */
export function matchWords(query: string, m: Describable): string[] {
  const q = new Set(tokens(query));
  const mine = new Set([m.category, ...m.keywords, ...tokens(m.name), ...m.slug.split("-")].map((w) => stem(w.toLowerCase())).filter((w) => w.length >= 3));
  return [...mine].filter((w) => q.has(w));
}
