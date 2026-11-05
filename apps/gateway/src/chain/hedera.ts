import {
  Client, PrivateKey, TokenId, TopicMessageSubmitTransaction, TransactionId, TransferTransaction,
} from "@hiero-ledger/sdk";
import { env } from "../env.ts";

export function parseKey(k: string): PrivateKey {
  // DER is what the portal exports; fall back to raw hex (ECDSA or ED25519).
  try { return PrivateKey.fromStringDer(k); } catch { /* fallthrough */ }
  try { return PrivateKey.fromStringECDSA(k); } catch { /* fallthrough */ }
  return PrivateKey.fromStringED25519(k);
}

export const gatewayKey = parseKey(env.gatewayKey);
export const vaultKey = parseKey(env.vaultKey);
export const USDC = TokenId.fromString(env.usdc);

export const client = (env.network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet())
  .setOperator(env.gatewayId, gatewayKey);

export const newRefundTxId = () => TransactionId.generate(env.gatewayId).toString();

/** Case A: the merchant was paid, so the bond pays. Atomic: vault -> agent (price) and vault -> gateway (penalty). */
export async function refundFromBond(opts: { paymentId: string; agent: string; price: number; penalty: number; txId: string }) {
  const tx = new TransferTransaction()
    .addTokenTransfer(USDC, env.vaultId, -(opts.price + opts.penalty))
    .addTokenTransfer(USDC, opts.agent, opts.price)
    .addTokenTransfer(USDC, env.gatewayId, opts.penalty)
    .setTransactionMemo(`refund:${opts.paymentId}`)
    .setTransactionId(TransactionId.fromString(opts.txId))
    .freezeWith(client);
  await tx.sign(vaultKey);
  const response = await tx.execute(client); // operator key signs for the gateway
  const receipt = await response.getReceipt(client);
  return { txId: response.transactionId.toString(), status: receipt.status.toString() };
}

/** Case B or C: the gateway still holds the money, so it pays. */
export async function refundFromGateway(opts: { paymentId: string; agent: string; amount: number; txId: string }) {
  const tx = new TransferTransaction()
    .addTokenTransfer(USDC, env.gatewayId, -opts.amount)
    .addTokenTransfer(USDC, opts.agent, opts.amount)
    .setTransactionMemo(`refund:${opts.paymentId}`)
    .setTransactionId(TransactionId.fromString(opts.txId))
    .freezeWith(client);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return { txId: response.transactionId.toString(), status: receipt.status.toString() };
}

/** Bond withdrawal: vault -> the merchant's payout account. The gateway pays the network fee. */
export async function withdrawFromBond(opts: { merchantId: string; to: string; amount: number }) {
  const tx = new TransferTransaction()
    .addTokenTransfer(USDC, env.vaultId, -opts.amount)
    .addTokenTransfer(USDC, opts.to, opts.amount)
    .setTransactionMemo(`withdraw:${opts.merchantId}`)
    .freezeWith(client);
  await tx.sign(vaultKey);
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return { txId: response.transactionId.toString(), status: receipt.status.toString() };
}

export async function publishReceipt(message: object): Promise<number> {
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(env.hcsTopicId)
    .setMessage(JSON.stringify(message))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  return Number(receipt.topicSequenceNumber);
}
