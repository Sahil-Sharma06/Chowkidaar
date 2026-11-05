"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, type ApprovalRow } from "@/lib/api";
import { Alert, Badge, Empty, Money } from "@/lib/ui";

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["approvals", "pending"], queryFn: () => get<ApprovalRow[]>("/api/approvals?status=pending"), refetchInterval: 3000 });
  const decide = useMutation({ mutationFn: ({ id, d }: { id: string; d: "approve" | "reject" }) => post(`/api/approvals/${id}/${d}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }) });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pending approvals</h1>
      <Alert tone="blue">Nothing has been paid yet. After you decide, the agent can retry this call for the next 15 minutes.</Alert>
      {q.data?.length === 0 ? <Empty title="No pending approvals" /> : (
        <div className="card overflow-x-auto p-0"><table className="table">
          <thead><tr><th>Agent</th><th>Merchant</th><th>Amount</th><th>Score</th><th>Time left</th><th></th></tr></thead>
          <tbody>{q.data?.map((a) => (
            <tr key={a.id}>
              <td>{a.agentName}</td><td>{a.merchantName} <span className="text-xs text-slate-500">({a.merchantSlug})</span></td>
              <td><Money micro={a.amount} /></td><td>{a.merchantScore ?? <Badge tone="blue">New</Badge>}</td>
              <td className="text-xs">{Math.max(0, Math.round((a.expiresAt - Date.now()) / 60000))} min</td>
              <td className="flex gap-2"><button className="btn-primary px-3 py-1" onClick={() => decide.mutate({ id: a.id, d: "approve" })}>Approve</button><button className="btn-secondary px-3 py-1" onClick={() => decide.mutate({ id: a.id, d: "reject" })}>Reject</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
