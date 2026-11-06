"use client";
import { Suspense } from "react";
import { ApprovalQueue, PageHeader } from "@/components/owner/kit";

export default function ApprovalsPage() {
  return (
    <div>
      <PageHeader title="Approvals" sub="Payments above an agent's approval limit wait here for your answer." />
      <Suspense><ApprovalQueue /></Suspense>
    </div>
  );
}
