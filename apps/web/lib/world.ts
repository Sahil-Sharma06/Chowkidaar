/** Plain-language text for every way a World ID request can end without success. */
const REASONS: Record<string, string> = {
  access_denied: "You cancelled the World ID request.",
  expired: "The request took too long and expired.",
  state_unknown_or_expired: "This World ID link was already used or has expired.",
  stale_authentication: "World ID did not return a fresh verification.",
  nonce_mismatch: "The response did not match this request.",
  invalid_id_token: "World ID's answer could not be verified.",
  identity_mismatch: "A different World ID than the one on this account was used.",
  approval_expired: "This approval request has expired or was already decided.",
  session_ended: "Your session ended while verifying. Sign in and try again.",
  not_found: "That request no longer exists.",
  human_already_registered: "This World ID is already linked to another merchant account. One human can run one merchant.",
  verification_failed: "World ID could not verify you.",
  verification_level_too_low: "Your World ID is not verified yet. Complete Selfie Check in the World App, then try again.",
};
export const reasonText = (r: string | null | undefined) => (r && REASONS[r]) || "World ID did not confirm who you are.";
