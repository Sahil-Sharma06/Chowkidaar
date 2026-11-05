import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
(addFormats as unknown as (a: Ajv) => void)(ajv);

export type CallResult =
  | {
      kind: "response";
      status: number;
      text: string;
      latencyMs: number;
      merchantPaid: boolean;
      merchantTxId: string | null;
    }
  | {
      kind: "error";
      reason: "timeout" | "price_mismatch" | "network_error" | "gateway_error";
      detail: string;
      latencyMs: number;
      merchantPaid: boolean | null; // null = unknown, check the chain
      merchantTxId: string | null;
    };

export type Verdict = { ok: true } | { ok: false; reason: string; detail?: string };

const cache = new Map<string, { schemaJson: string; validate: ValidateFunction }>();

/** Throws if the schema cannot be compiled or is too loose to catch an empty response. */
export function compileSchema(key: string, schema: Record<string, unknown>): ValidateFunction {
  const schemaJson = JSON.stringify(schema);
  const hit = cache.get(key);
  if (hit && hit.schemaJson === schemaJson) return hit.validate;
  if (schema.type !== "object" || !Array.isArray(schema.required) || schema.required.length === 0) {
    throw new Error('Schema must have type "object" and a non-empty "required" list');
  }
  const validate = ajv.compile(schema);
  cache.set(key, { schemaJson, validate });
  return validate;
}

export function runChecks(
  result: CallResult,
  merchant: { id: string; responseSchema: Record<string, unknown> },
): Verdict {
  if (result.kind !== "response") return { ok: false, reason: result.reason, detail: result.detail };
  if (result.status < 200 || result.status >= 300) return { ok: false, reason: "http_error", detail: `HTTP ${result.status}` };
  if (!result.text.trim()) return { ok: false, reason: "empty_body" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { ok: false, reason: "bad_format", detail: "Not valid JSON" };
  }

  const validate = compileSchema(merchant.id, merchant.responseSchema);
  if (!validate(parsed)) {
    return { ok: false, reason: "bad_format", detail: ajv.errorsText(validate.errors) };
  }
  return { ok: true };
}
