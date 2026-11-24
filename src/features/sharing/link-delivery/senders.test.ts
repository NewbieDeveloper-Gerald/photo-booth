import { describe, expect, it, vi } from 'vitest';
import { mockLinkSender, webhookLinkSender } from './senders';
import type { FetchLike } from './senders';
import type { LinkDeliveryRequest } from './types';

const request: LinkDeliveryRequest = {
  channel: 'sms', to: '+639171234567', message: 'Gala Night: photos https://photos.example.com/d/token',
  link: 'https://photos.example.com/d/token', eventName: 'Gala Night',
};

describe('link senders (F28)', () => {
  it('the demo sender counts sends and keeps nothing else', async () => {
    const sender = mockLinkSender();
    const first = await sender.send(request);
    await sender.send({ ...request, channel: 'email', to: 'guest@example.com' });
    expect(first.delivered).toBe(true);
    expect(first.detail).toContain('demo sender');
    expect(sender.sends).toBe(2);
    // Nothing about the targets survives on the sender object.
    expect(JSON.stringify(Object.keys(sender))).not.toContain('63917');
  });

  it('posts the message to the operator gateway', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ ok: true, status: 200 }));
    const sender = webhookLinkSender('https://gateway.example/send', fetchImpl);
    expect(sender.name).toBe('gateway');
    const result = await sender.send(request);
    expect(result).toEqual({ delivered: true, detail: 'Sent through the configured gateway.' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    if (!init) throw new Error('the gateway was not called with a request');
    expect(url).toBe('https://gateway.example/send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      channel: 'sms', to: '+639171234567', message: request.message, link: request.link, eventName: 'Gala Night',
    });
  });

  it('reports a gateway that refuses or cannot be reached', async () => {
    const refused = webhookLinkSender('https://gateway.example/send', async () => ({ ok: false, status: 502 }));
    expect(await refused.send(request)).toEqual({ delivered: false, detail: 'The gateway refused the message (HTTP 502).' });

    const offline = webhookLinkSender('https://gateway.example/send', async () => { throw new Error('ECONNREFUSED'); });
    expect(await offline.send(request)).toEqual({ delivered: false, detail: 'The gateway could not be reached. Check its address and try again.' });
  });
});
