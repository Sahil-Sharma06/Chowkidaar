"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, get, type MerchantMe } from "@/lib/api";
import { Empty } from "@/lib/ui";
import { LoadError, PageHeader } from "@/components/owner/kit";
import { BondPanel } from "@/components/BondPanel";

export default function BondPage() {
  const me = useQuery({ queryKey: ["merchant-me"], queryFn: () => get<MerchantMe>("/api/merchants/me"), retry: false });
  if (me.isLoading) return <div className="space-y-5"><div className="skeleton h-10 w-48" /><div className="skeleton h-72" /></div>;
  if (me.error instanceof ApiError && me.error.status === 404) {
    return <Empty title="Register your service first, then post a bond to go live." action={<Link href="/merchant/setup" className="btn-primary">Set up your service</Link>} />;
  }
  if (!me.data) return <LoadError what="your service" retry={() => me.refetch()} />;
  return (
    <div>
      <PageHeader
        title="Bond"
        sub={<>USDC you post so agents get their money back when {me.data.name} fails. Held in a custodial testnet vault for now.</>}
        actions={<Link href="/merchant" className="btn-ghost">Dashboard</Link>}
      />
      <Suspense><BondPanel merchantId={me.data.id} /></Suspense>
    </div>
  );
}
