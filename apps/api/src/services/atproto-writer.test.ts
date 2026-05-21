import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context.js';
import { ResultAsync } from '@openxiv/shared';
import { putAtProtoRecord } from './atproto-writer.js';

describe('putAtProtoRecord', () => {
  it('writes did:plc records through the restored Bluesky OAuth session', async () => {
    const post = vi.fn(() =>
      ResultAsync.fromSafePromise(
        Promise.resolve({ uri: 'at://did:plc:alice/app.openxiv.paper/r1', cid: 'cid1' }),
      ),
    );
    const restoreSession = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve({ did: 'did:plc:alice', post })),
    );
    const pdsPut = vi.fn();
    const ctx = {
      clients: {
        bluesky: { restoreSession },
        pds: { putRecord: pdsPut },
      },
    } as unknown as AppContext;

    const result = await putAtProtoRecord(ctx, {
      repo: 'did:plc:alice',
      collection: 'app.openxiv.paper',
      rkey: 'r1',
      record: { title: 'Paper' },
    });

    expect(result.isOk()).toBe(true);
    expect(restoreSession).toHaveBeenCalledWith('did:plc:alice');
    expect(pdsPut).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('com.atproto.repo.putRecord', {
      repo: 'did:plc:alice',
      collection: 'app.openxiv.paper',
      rkey: 'r1',
      record: { $type: 'app.openxiv.paper', title: 'Paper' },
    });
  });

  it('keeps did:web records on the configured PDS client', async () => {
    const pdsPut = vi.fn(() =>
      ResultAsync.fromSafePromise(
        Promise.resolve({ uri: 'at://did:web:openxiv.net/app.openxiv.paper/r1', cid: 'cid1' }),
      ),
    );
    const restoreSession = vi.fn();
    const ctx = {
      clients: {
        bluesky: { restoreSession },
        pds: { putRecord: pdsPut },
      },
    } as unknown as AppContext;

    const result = await putAtProtoRecord(ctx, {
      repo: 'did:web:openxiv.net:u:orcid.0000',
      collection: 'app.openxiv.paper',
      rkey: 'r1',
      record: { title: 'Paper' },
    });

    expect(result.isOk()).toBe(true);
    expect(restoreSession).not.toHaveBeenCalled();
    expect(pdsPut).toHaveBeenCalledWith({
      repo: 'did:web:openxiv.net:u:orcid.0000',
      collection: 'app.openxiv.paper',
      rkey: 'r1',
      record: { title: 'Paper' },
    });
  });
});
