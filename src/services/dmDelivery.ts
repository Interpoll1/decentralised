import type { SignalEnvelope } from './signalProtocol';
export const RECEIPT_PREFIX = '\u0000DM-DELIVERED-1:';
export async function envelopeDigest(id: string, sender: string, recipient: string, e: SignalEnvelope): Promise<string> {
  const input = JSON.stringify(['interpoll-dm-delivery-1', id, sender, recipient,
    e.v, e.eph ?? '', e.opkId ?? '', e.dh, e.n, e.pn, e.ct]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
