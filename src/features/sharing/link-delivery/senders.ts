import type { LinkDeliveryResult, LinkSender } from './types';

/**
 * The stand-in used when no provider is configured. It deliberately keeps nothing: the count of
 * sends is all an operator can see, so a booth without a gateway cannot accidentally become a
 * store of guests' addresses.
 */
export function mockLinkSender(): LinkSender & { sends: number } {
  let sends = 0;
  return {
    name: 'demo sender',
    get sends() { return sends; },
    async send(): Promise<LinkDeliveryResult> {
      sends += 1;
      return {
        delivered: true,
        detail: 'Handed to the demo sender — connect an email/SMS gateway to really deliver it.',
      };
    },
  };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

/**
 * The seam made usable without a service account: the operator points the booth at their own
 * gateway (a small HTTP service that talks to their email/SMS provider) and it receives
 * `{ channel, to, message, link, eventName }`. The booth still keeps nothing afterwards.
 */
export function webhookLinkSender(url: string, fetchImpl: FetchLike): LinkSender {
  return {
    name: 'gateway',
    async send(request): Promise<LinkDeliveryResult> {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            channel: request.channel, to: request.to, message: request.message, link: request.link, eventName: request.eventName,
          }),
        });
        if (!response.ok) {
          return { delivered: false, detail: `The gateway refused the message (HTTP ${response.status}).` };
        }
        return { delivered: true, detail: 'Sent through the configured gateway.' };
      } catch {
        return { delivered: false, detail: 'The gateway could not be reached. Check its address and try again.' };
      }
    },
  };
}
