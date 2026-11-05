"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get, type MerchantMe } from "@/lib/api";
import { Alert, Empty } from "@/lib/ui";
import { BondPanel } from "@/components/BondPanel";

export default function BondPage() {
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  if (me.isLoading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (me.error instanceof ApiError && me.error.status === 404) return <Empty title="Register your service first." action={<Link href="/merchant/setup" className="btn-primary">Set up</Link>} />;
  if (!me.data) return <Alert tone="red">Could not load your merchant.</Alert>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Bond</h1>
      <Alert tone="amber">Your bond is held in a custodial testnet vault in this version. A smart-contract vault is the next step.</Alert>
      <Suspense><BondPanel merchantId={me.data.id} /></Suspense>
    </div>
  );
}
