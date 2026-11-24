/** How the guest asked to receive the link (F28). */
export type LinkChannel = 'email' | 'sms';

export const LINK_CHANNEL_LABELS: Record<LinkChannel, string> = {
  email: 'Email',
  sms: 'SMS',
};

/**
 * The payment-style seam for sending (F28): the booth composes a message and hands it to one of
 * these. A real email/SMS provider or an operator's own gateway plugs in here without the booth
 * ever keeping the address.
 */
export type LinkDeliveryRequest = {
  channel: LinkChannel;
  /** The address or number, used for this one send and then dropped. */
  to: string;
  /** The message body the guest will read; carries the link and the expiry. */
  message: string;
  /** The guest's download link, on its own, for providers that want a structured field. */
  link: string;
  eventName: string;
};

export type LinkDeliveryResult = {
  delivered: boolean;
  /** Operator wording for the panel; never echoes the address back in full. */
  detail: string;
};

export type LinkSender = {
  /** Human name shown on the operator panel, e.g. "demo sender". */
  readonly name: string;
  send(request: LinkDeliveryRequest): Promise<LinkDeliveryResult>;
};

/** What the renderer gets back: a confirmation, never the address itself. */
export type SendLinkOutcome = {
  channel: LinkChannel;
  /** Masked target, e.g. "j•••@example.com" or "+63 ••• 4567". */
  maskedTarget: string;
  detail: string;
};
