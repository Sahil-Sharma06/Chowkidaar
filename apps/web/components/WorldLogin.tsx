"use client";
import { useState } from "react";
import { IDKitRequestWidget, orbLegacy, type RpContext } from "@worldcoin/idkit";
import { ApiError, get, post } from "@/lib/api";

type Role = "owner" | "merchant";

export function WorldLogin({ role, onDone, onError }: { role: Role; onDone: () => void; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ action: string; rp_context: RpContext } | null>(null);

  async function start() {
    try {
      // rp_context expires, so fetch a fresh one every time.
      setRequest(await get("/api/world/rp-context?role=" + role));
      setOpen(true);
    } catch {
      onError("Something went wrong. Please try again.");
    }
  }

  return (
    <>
      <button className="btn-primary w-full" onClick={start}>Verify with World ID</button>
      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}`}
          action={request.action}
          rp_context={request.rp_context}
          allow_legacy_proofs={true}
          preset={orbLegacy({ signal: role })}
          environment={(process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT as "staging" | "production") ?? "staging"}
          handleVerify={async (result) => {
            try {
              await post("/api/world/verify", { role, idkitResponse: result });
            } catch (err) {
              const code = err instanceof ApiError ? err.code : "network";
              onError(code === "suspended" ? "This merchant account is suspended." : code === "verification_failed" || code === "action_mismatch" ? "We couldn't verify you. Please try again." : "Something went wrong. Please try again.");
              throw err;
            }
          }}
          onSuccess={onDone}
          onError={(code, debug) => console.error("IDKit error", code, debug)}
        />
      )}
    </>
  );
}
