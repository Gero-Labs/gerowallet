// The vault-invite routes over a fake signed transport: the paths and bodies sent, and gero-sync's
// answers read strictly (a malformed row is dropped, a malformed answer refused, errors mapped).
import { describe, expect, it, vi } from 'vitest';
import { InviteApiError, createInviteApi, type InviteTransport } from './inviteApi';

const SETUP = 'a1'.repeat(16);
const INVITE = 'b2'.repeat(16);
const wrap = { slot: 0, recipientKey: 'c3'.repeat(32), ephemeralKey: 'd4'.repeat(32), nonce: 'e5'.repeat(24), wrappedKey: 'f6'.repeat(48) };
const delivery = { wrap, nonce: '07'.repeat(24), ciphertext: 'AbC-_9' };

function api(answer: unknown) {
  const send = vi.fn(async () => answer);
  return { send, api: createInviteApi({ send } as unknown as InviteTransport) };
}

describe('inviteApi', () => {
  it('sends the routes of PROTOCOL 7 with their bodies', async () => {
    const { send, api: a } = api({ network: 'cardano-preprod', stakeCredential: '11'.repeat(28), entries: [0, 1, 2, 3, 4].map(slot => ({ slot, inviteKey: '22'.repeat(32) })) });
    await a.directory('cardano-preprod', '11'.repeat(28));
    expect(send).toHaveBeenLastCalledWith('POST', '/vault-invites/recipients', { network: 'cardano-preprod', stakeCredential: '11'.repeat(28) });
    send.mockResolvedValueOnce(null as never);
    await a.remind(SETUP, INVITE);
    expect(send).toHaveBeenLastCalledWith('POST', `/vault-setups/${SETUP}/invites/${INVITE}/remind`, {});
    await expect(a.remind('not hex', INVITE)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('refuses a directory that is not exactly five slots in order', async () => {
    const short = api({ network: 'cardano-preprod', stakeCredential: '11'.repeat(28), entries: [{ slot: 0, inviteKey: '22'.repeat(32) }] });
    await expect(short.api.directory('cardano-preprod', '11'.repeat(28))).rejects.toMatchObject({ code: 'invalid_response' });
    const other = api({ network: 'cardano-mainnet', stakeCredential: '11'.repeat(28), entries: [] });
    await expect(other.api.directory('cardano-preprod', '11'.repeat(28))).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('drops malformed invitation rows and keeps the well-formed ones', async () => {
    const good = { inviteId: INVITE, setupId: SETUP, network: 'cardano-preprod', stakeCredential: '11'.repeat(28), state: 'open', createdAt: 1, expiresAt: 2, delivery };
    const { api: a } = api({
      invites: [
        good,
        { ...good, inviteId: 'XYZ' },
        { ...good, network: 'bitcoin' },
        { ...good, state: 'accepted' }, // a delivery on a closed invitation
        { ...good, delivery: { ...delivery, wrap: { ...wrap, slot: 9 } } },
        { ...good, delivery: undefined, state: 'revoked', revoke: 'not base64url!' },
      ],
    });
    expect(await a.listInvites()).toEqual([good]);
  });

  it('reads a response channel only when exactly one of invite and link is named', async () => {
    const base = { responseId: INVITE, kind: 'accept', receivedAt: 1, delivery };
    const { api: a } = api({
      setupId: SETUP, network: 'cardano-preprod', state: 'open', expiresAt: 9, invites: [], links: [],
      responses: [{ ...base, inviteId: INVITE }, { ...base, inviteId: INVITE, joinTokenHash: '33'.repeat(32) }, { ...base }],
    });
    const read = await a.responses(SETUP);
    expect(read.responses).toHaveLength(1);
    await expect(api({ setupId: 'ff'.repeat(16), network: 'cardano-preprod', state: 'open', expiresAt: 9, invites: [], links: [], responses: [] }).api.responses(SETUP))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('maps the notify client errors', async () => {
    const throwing = (error: unknown) => createInviteApi({ send: async () => { throw error; } } as InviteTransport);
    await expect(throwing({ name: 'NotifyError', status: 422, code: 'too_many_pending', details: { open: [] } }).listInvites())
      .rejects.toMatchObject({ code: 'too_many_pending', status: 422, details: { open: [] } });
    await expect(throwing({ name: 'NotifyError', status: 0, code: 'network' }).listInvites()).rejects.toMatchObject({ code: 'network' });
    await expect(throwing({ name: 'NotifyDeferred' }).listInvites()).rejects.toMatchObject({ code: 'deferred' });
    await expect(throwing(new Error('boom')).listInvites()).rejects.toBeInstanceOf(InviteApiError);
  });
});
