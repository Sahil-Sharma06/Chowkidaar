export type PaymentStatus = "calling" | "delivered" | "refund_pending" | "refunded" | "refund_failed";
export type FaultCase = "A" | "B" | "C";
export type MerchantStatus = "draft" | "testing" | "needs_bond" | "live" | "paused" | "suspended";
export type Role = "owner" | "merchant";

export interface Receipt {
  paymentId: string;
  status: PaymentStatus;
  reason: string | null;
  detail: string | null;
  faultCase: FaultCase | null;
  merchant: { id: string; slug: string; name: string };
  agentAccount: string;
  agentName: string;
  agentUaid: string | null; // HCS-14 Universal Agent ID
  money: {
    price: string;
    fee: string;
    agentPaid: string;
    merchantReceived: string;
    refunded: string;
    feeKept: string;
    bondSlashed: string;
  };
  tx: { agent: string | null; merchant: string | null; refund: string | null };
  links: { agent: string | null; merchant: string | null; refund: string | null; hcs: string | null; arkiv: string | null };
  hcs: { topicId: string | null; sequence: number | null };
  arkivEntityKey: string | null;
  responseHash: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface PublicMerchant {
  id: string;
  slug: string;
  name: string;
  price: string;
  status: MerchantStatus;
  score: number | null;
  totalCalls: number;
  failedCalls: number;
  bondAvailable: string;
  covered: boolean;
  arkivEntityKey: string | null;
  category: string;
  keywords: string[];
  description: string | null;
  samplePrompt: string | null;
}

export interface PublicStats {
  protectedCalls: number;
  refunds: number;
  usdcRefunded: string;
  merchants: number;
}

export interface DemoStep {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
  link?: string;
}

export interface DemoRunResult {
  scenario: string;
  outcome: "delivered" | "refund_pending" | "blocked" | "error";
  paymentId: string | null;
  steps: DemoStep[];
  gatewayStatus: number | null;
  gatewayResponse: unknown;
  error?: string;
}
