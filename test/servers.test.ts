// A chipnet server whose node fell off the network keeps answering, but its newest block gets
// older and older and nothing sent through it confirms. The demo tools and keeper warn about it.
import { describe, expect, it } from 'vitest';
import { binToHex, sha256, utf8ToBin } from '@bitauth/libauth';
import { blockTime, staleServerWarning, tipAgeMinutes } from '@backstop/contracts';
import { MemCashProvider, walletFromPrivateKey } from '@backstop/demo';

describe('Spotting a stuck Electrum server', () => {
  it('stays quiet while blocks are recent, and warns once the newest block is hours old', async () => {
    const provider = new MemCashProvider();
    const someone = walletFromPrivateKey(sha256.hash(utf8ToBin('servers test')));
    provider.addUtxo(someone.lockingBytecode, { txid: binToHex(sha256.hash(utf8ToBin('s'))), vout: 0, satoshis: 10_000n });
    provider.mine();

    // The in-memory node stamps blocks with its own clock, so measure from the block's time.
    const minedAt = (await blockTime(provider, await provider.getBlockHeight()))! * 1000;
    const tenMinutesLater = minedAt + 10 * 60 * 1000;
    const threeHoursLater = minedAt + 3 * 60 * 60 * 1000;

    expect(await tipAgeMinutes(provider, tenMinutesLater)).toBe(10);
    expect(await staleServerWarning(provider, 'fresh.example', tenMinutesLater)).toBeUndefined();
    expect(await staleServerWarning(provider, 'stuck.example', threeHoursLater)).toMatch(/newest block on stuck\.example is 3\.0 hours old/);
  });
});
