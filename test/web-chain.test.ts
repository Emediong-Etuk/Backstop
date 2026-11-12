// The web app's chipnet connection must survive the tab being hidden (the user approving in
// their wallet's tab). @electrum-cash/web-socket disconnects hidden tabs unless told not to.
import { describe, expect, it } from 'vitest';
import { chipnetProvider } from '../web/lib/chain';

describe("The web app's chipnet connection", () => {
  it('does not disconnect when the browser tab is hidden', () => {
    const provider = chipnetProvider('chipnet.example');
    const socket = (provider as any).electrum.connection.socket;
    expect(socket.options.enforceConsistentBrowserBehavior).toBe(false);
    expect(socket.host ?? socket.hostIdentifier).toContain('chipnet.example');
  });
});
