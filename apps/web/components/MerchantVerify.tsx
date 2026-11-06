"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
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
  const [starting, setStarting] = useState(false);

  async function start() {
    if (starting) return;
    setStarting(true);
    try {
      setRequest(await get("/api/world/rp-context")); // expires, so always fresh
      setOpen(true);
    } catch {
      onError("Couldn't start World ID verification. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-primary w-full" onClick={start} disabled={starting}>
        <ShieldCheck aria-hidden className="h-4 w-4" /> {starting ? "Opening World ID…" : "Verify I\u2019m a unique human"}
      </button>
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
