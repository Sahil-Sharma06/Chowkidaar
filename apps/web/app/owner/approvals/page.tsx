"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { ApiError, get, post, type ApprovalRow } from "@/lib/api";
import { Alert, Badge, Empty, Money } from "@/lib/ui";
import { reasonText } from "@/lib/world";

export default function ApprovalsPage() {
  return <Suspense><Approvals /></Suspense>;
}

function Approvals() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const world = params.get("world");
  const cfg = useQuery({ queryKey: ["auth-config"], queryFn: () => get<{ agentPass: boolean }>("/api/auth/config") });
  const q = useQuery({ queryKey: ["approvals", "pending"], queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"), refetchInterval: 3000 });
  const decide = useMutation({ mutationFn: ({ id, d }: { id: string; d: "approve" | "reject" }) => post(`/api/approvals/${id}/${d}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }) });
  const agentPass = cfg.data?.agentPass === true;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pending approvals</h1>
      {world === "approved" && <Alert tone="green">Approved with a fresh World ID verification. The agent can retry this call for the next 15 minutes.</Alert>}
      {world === "denied" && <Alert tone="red">{reasonText(params.get("reason"))} The payment was not approved and stays blocked.</Alert>}
      {decide.isError && <Alert tone="red">{decide.error instanceof ApiError && decide.error.code === "expired" ? "That request expired before you decided." : "Could not save your decision. Please try again."}</Alert>}
      <Alert tone="blue">Nothing has been paid yet. After you decide, the agent can retry this call for the next 15 minutes.{agentPass && " Approving requires a fresh World ID verification (Agent Pass step-up)."}</Alert>
      {q.data?.length === 0 ? <Empty title="No pending approvals" /> : (
        <div className="card overflow-x-auto p-0"><table className="table">
          <thead><tr><th>Agent</th><th>Merchant</th><th>Amount</th><th>Score</th><th>Time left</th><th></th></tr></thead>
          <tbody>{q.data?.map((a) => (
            <tr key={a.id}>
              <td>{a.agentName}</td><td>{a.merchantName} <span className="text-xs text-slate-500">({a.merchantSlug})</span></td>
              <td><Money micro={a.amount} /></td><td>{a.merchantScore ?? <Badge tone="blue">New</Badge>}</td>
              <td className="text-xs">{Math.max(0, Math.round((a.expiresAt - Date.now()) / 60000))} min</td>
              <td className="flex gap-2">
                {agentPass
                  ? <a className="btn-primary px-3 py-1" href={`/api/world/oidc/start?purpose=approval&approvalId=${a.id}`}><ShieldCheck className="h-4 w-4" /> Approve with World ID</a>
                  : <button className="btn-primary px-3 py-1" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, d: "approve" })}>{decide.isPending && decide.variables?.id === a.id && decide.variables.d === "approve" ? "Approving…" : "Approve"}</button>}
                <button className="btn-secondary px-3 py-1" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, d: "reject" })}>{decide.isPending && decide.variables?.id === a.id && decide.variables.d === "reject" ? "Rejecting…" : "Reject"}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
