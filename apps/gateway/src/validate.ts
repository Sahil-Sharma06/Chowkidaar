import { zValidator as base } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/**
 * zValidator with a readable 400: `{ error: "invalid_input", detail: "slug: Lowercase letters, numbers, dashes" }`.
 * The library default puts the whole ZodError object under `error`, which clients render as "[object Object]".
 */
export function zValidator<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return base(target, schema, (result, c) => {
    if (result.success) return;
    const issues = result.error.issues.map((i) => `${i.path.join(".") || target}: ${i.message}`);
    return c.json({ error: "invalid_input", detail: issues.join("; "), issues }, 400);
  });
}
