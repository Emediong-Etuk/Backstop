// TEST ONLY. A minimal in-memory Nostr relay (NIP-01: EVENT, REQ, CLOSE) on localhost, so
// WizardConnect's dapp and wallet sides can talk without the internet. It does not verify
// signatures; WizardConnect's own NIP-17 encryption and authentication still run end to end.
import { WebSocketServer, type WebSocket } from 'ws';

type NostrEvent = { id: string; pubkey: string; kind: number; created_at: number; tags: string[][] };
type Filter = { ids?: string[]; authors?: string[]; kinds?: number[]; since?: number; until?: number; limit?: number } & Record<string, unknown>;

function matches(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue;
    const name = key.slice(1);
    if (!event.tags.some((t) => t[0] === name && (values as string[]).includes(t[1]))) return false;
  }
  return true;
}

export async function startNostrRelay(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const events: NostrEvent[] = [];
  const subscriptions = new Map<WebSocket, Map<string, Filter[]>>();

  server.on('connection', (socket) => {
    subscriptions.set(socket, new Map());
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', (raw) => {
      let message: unknown[];
      try { message = JSON.parse(String(raw)); } catch { return; }
      const [type, ...rest] = message;
      if (type === 'EVENT') {
        const event = rest[0] as NostrEvent;
        events.push(event);
        socket.send(JSON.stringify(['OK', event.id, true, '']));
        for (const [peer, subs] of subscriptions) {
          for (const [id, filters] of subs) {
            if (filters.some((f) => matches(event, f))) peer.send(JSON.stringify(['EVENT', id, event]));
          }
        }
      } else if (type === 'REQ') {
        const [id, ...filters] = rest as [string, ...Filter[]];
        subscriptions.get(socket)?.set(id, filters);
        for (const event of events) if (filters.some((f) => matches(event, f))) socket.send(JSON.stringify(['EVENT', id, event]));
        socket.send(JSON.stringify(['EOSE', id]));
      } else if (type === 'CLOSE') {
        subscriptions.get(socket)?.delete(rest[0] as string);
      }
    });
  });

  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('relay did not start');
  return {
    url: `ws://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      for (const socket of subscriptions.keys()) socket.terminate();
      server.close(() => resolve());
    }),
  };
}
