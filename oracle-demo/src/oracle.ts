// DEMO ORACLE. Signs price messages in the real General Protocols format with a demo key, so
// the price can be made to fall on camera. Paryon's price contract on our chipnet deployment
// accepts this key; on mainnet the price contract (and so Backstop) uses General Protocols'
// key 02d09db08af1ff4e8453919cc866a4be427d7bfe18f2c05e5444c196fcf6fd2818 instead.
import { OracleData } from '@generalprotocols/price-oracle';
import type { DemoWallet } from './wallet.js';

export interface SignedPrice {
  /** 16 bytes: timestamp, message sequence, data sequence, price (all int32 little-endian). */
  message: Uint8Array;
  /** Schnorr signature over sha256(message): what checkDataSig verifies. */
  signature: Uint8Array;
  priceCents: bigint;
  dataSequence: bigint;
}

export async function signDemoPrice(oracle: DemoWallet, args: { priceCents: bigint; dataSequence: bigint; timestamp?: number }): Promise<SignedPrice> {
  if (args.priceCents <= 0n || args.priceCents > 2_147_483_647n) throw new Error('price out of range');
  const dataSequence = Number(args.dataSequence);
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000);
  // The demo oracle produces only price messages, so its message and data sequences are equal.
  const message = await OracleData.createPriceMessage(timestamp, dataSequence, dataSequence, Number(args.priceCents));
  const signature = await OracleData.signMessage(message, oracle.wif);
  return { message, signature, priceCents: args.priceCents, dataSequence: args.dataSequence };
}

/**
 * Paryon's price contract accepts a message whose data sequence is higher than the one it holds
 * and is either a multiple of 10 (the 10-minute heartbeat) or a move of at least 0.5%
 * (PriceContract.cash:56-77). The next multiple of 10 is always accepted.
 */
export function nextHeartbeatSequence(current: bigint): bigint {
  return (current / 10n + 1n) * 10n;
}
