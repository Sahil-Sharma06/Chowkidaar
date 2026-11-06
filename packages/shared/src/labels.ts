export const PAYMENT_STATUS = {
  calling: { label: "In progress", color: "blue" },
  delivered: { label: "Delivered", color: "green" },
  refund_pending: { label: "Refund in progress", color: "amber" },
  refunded: { label: "Refunded", color: "amber" },
  refund_failed: { label: "Refund failed", color: "red" },
} as const;

export const REASON_LABEL: Record<string, string> = {
  http_error: "Service returned an error",
  timeout: "Service took too long",
  empty_body: "Empty response",
  bad_format: "Wrong format",
  price_mismatch: "Merchant charged a different price",
  network_error: "Couldn't reach the service",
  gateway_error: "Our error, full refund",
  bond_lock_failed: "Our error, full refund",
  payer_mismatch: "Our error, full refund",
};

export const POLICY_ERROR_LABEL: Record<string, string> = {
  invalid_agent_key: "Invalid agent key",
  agent_paused: "Agent is paused",
  per_call_cap_exceeded: "Above this agent's per-call limit",
  daily_cap_exceeded: "Daily limit reached",
  merchant_daily_cap_exceeded: "Daily limit for this merchant reached",
  merchant_not_allowed: "Merchant isn't on the allowed list",
  merchant_low_reputation: "Merchant's score is below your minimum",
  merchant_not_covered: "Merchant's bond is too low to cover this call",
  merchant_not_available: "Merchant isn't available",
  approval_required: "Needs owner approval",
};

export const MERCHANT_STATUS_TEXT: Record<string, string> = {
  draft: "Finish setup",
  testing: "Test your endpoint",
  needs_bond: "Add a bond to go live",
  live: "Agents can pay you",
  paused: "Your bond is too low or you've paused",
  suspended: "Suspended",
};

export const DEPOSIT_ERROR_TEXT: Record<string, string> = {
  not_found_yet: "We can't see this transaction yet. Try again in a few seconds.",
  not_successful: "This transaction didn't succeed on Hedera.",
  wrong_memo: "The memo doesn't match. Contact support to recover this deposit.",
  no_vault_credit: "This transaction didn't send USDC to the vault.",
  duplicate: "This deposit has already been counted.",
};

/** Plain-language reasons a merchant was not chosen for a request. */
export const SKIP_REASON: Record<string, string> = {
  not_allowed: "not on the agent's allowlist",
  not_covered: "bond too low to cover a call",
  above_cap: "price above the per-call cap",
  merchant_cap: "today's limit for this merchant is used up",
  low_score: "score below the agent's minimum",
  no_match: "doesn't sell what was asked for",
};
