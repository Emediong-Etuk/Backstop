import { binToHex, hexToBin } from '@bitauth/libauth';

export { binToHex, hexToBin };

/** Unsigned little-endian integer of a fixed byte length, as hex. */
export function uintLE(value: bigint | number, byteLength: number): string {
  let rest = BigInt(value);
  if (rest < 0n) throw new Error(`uintLE: negative value ${value}`);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n) throw new Error(`uintLE: ${value} does not fit in ${byteLength} bytes`);
  return binToHex(bytes);
}

/** Read an unsigned little-endian integer from hex. */
export function readUintLE(hex: string): bigint {
  const bytes = hexToBin(hex);
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

/** Reverse the byte order of a hex string (display order <-> internal order). */
export function reverseHex(hex: string): string {
  return binToHex(hexToBin(hex).reverse());
}

export function assertHex(hex: string, byteLength: number, name: string): void {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length !== byteLength * 2) {
    throw new Error(`${name} must be ${byteLength} bytes of hex`);
  }
}
