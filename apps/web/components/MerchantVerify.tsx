"use client";
import { useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy, type RpContext } from "@worldcoin/idkit";
import { ApiError, get, post } from "@/lib/api";
import { reasonText } from "@/lib/world";

/**
 * IDKit Selfie Check (Orb also accepted) for the one trust moment that needs it: becoming a merchant.
 * A merchant posts a bond and receives agents' money, and if it misbehaves its bond is cut.
 * The proof's nullifier makes that stick: the same human can never open a second merchant.
 * The proof is verified on the server; the widget's result alone grants nothing.
 */
export function MerchantVerify({ onDone, onError }: { onDone: () => void; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ action: string; rp_context: RpContext } | null>(null);

  async function start() {
    try {
      setRequest(await get("/api/world/rp-context")); // expires, so always fresh
      setOpen(true);
    } catch {
      onError("World ID verification is unavailable right now. Please try again.");
    }
  }

  return (
    <>
      <button className="btn-primary w-full" onClick={start}>Verify I&apos;m a unique human</button>
      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}`}
          action={request.action}
          rp_context={request.rp_context}
          allow_legacy_proofs={true}
          preset={selfieCheckLegacy({ signal: "merchant" })}
          environment={(process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT as "staging" | "production") ?? "staging"}
          handleVerify={async (result) => {
            try {
              await post("/api/world/verify", { idkitResponse: result });
            } catch (err) {
              onError(reasonText(err instanceof ApiError ? err.code : null));
              throw err;
            }
          }}
          onSuccess={onDone}
          onError={(code) => onError(code === "user_rejected" || code === "cancelled" ? "You cancelled the World ID request. You were not registered as a merchant." : reasonText(null))}
        />
      )}
    </>
  );
}
