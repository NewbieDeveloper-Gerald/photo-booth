import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStorage } from '../../storage/database/initialize';
import { ensureBuiltinTemplates } from '../../layouts/data/template-repository';
import { createSession } from '../../capture/node';
import { saveEventSettings, selectActiveEvent } from '../../events/node';
import { clearLinkDeliveryThrottle, MAX_SENDS_PER_SESSION, sendSessionLink } from './delivery-service';
import type { LinkDeliveryRequest, LinkSender } from './types';

const directories: string[] = [];
const BASE_URL = 'https://photos.example.com';
const EMAIL = 'maria.santos@example.com';
const PHONE = '+639171234567';

afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => { clearLinkDeliveryThrottle(); });

function recordingSender(): LinkSender & { requests: LinkDeliveryRequest[] } {
  const requests: LinkDeliveryRequest[] = [];
  return {
    name: 'recording', requests,
    async send(request) { requests.push(request); return { delivered: true, detail: 'Sent.' }; },
  };
}

/** A finished session with a share token, its event, and the settings the service reads. */
function setup(options: { sendLinkEnabled?: boolean; completed?: boolean; token?: string | null } = {}): { directory: string; sessionId: string; eventId: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'photobooth-send-link-'));
  directories.push(directory);
  initializeStorage(directory);
  ensureBuiltinTemplates(directory);
  const event = saveEventSettings(directory, {
    id: '', name: 'Gala Night', shots: 1, expiryDays: 30, eventDate: null, primaryColor: '#123456', accentColor: '#ffffff',
    welcomeText: 'Welcome', thankYouText: 'Thanks', offeredLayoutIds: ['single-4x6'], contactText: 'ask@studio.ph',
    sendLinkEnabled: options.sendLinkEnabled ?? true,
  } as never);
  selectActiveEvent(directory, event.id);
  const { sessionId } = createSession(directory);
  const database = new Database(path.join(directory, 'photobooth.sqlite'));
  database.prepare('UPDATE sessions SET status = ?, public_token = ?, token_expires_at = ? WHERE id = ?')
    .run(options.completed === false ? 'active' : 'completed', options.token === undefined ? null : options.token,
      options.token === undefined || options.token === null ? null : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), sessionId);
  database.close();
  return { directory, sessionId, eventId: event.id };
}

describe('sending the link to a guest (F28)', () => {
  it('sends the finished link by email and by SMS, and reports only a masked target', async () => {
    const { directory, sessionId } = setup();
    const sender = recordingSender();
    const email = await sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: `  ${EMAIL} `, baseUrl: BASE_URL, sender });
    expect(email.channel).toBe('email');
    expect(email.maskedTarget).toBe('m•••••••••••@example.com');
    expect(email.detail).toBe('Sent.');
    expect(sender.requests[0]).toMatchObject({ channel: 'email', to: EMAIL, eventName: 'Gala Night' });
    expect(sender.requests[0]!.message).toContain('Your photos from Gala Night are ready to download:');
    expect(sender.requests[0]!.link).toMatch(/^https:\/\/photos\.example\.com\/d\/[A-Za-z0-9_-]{22}$/);

    const sms = await sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender });
    expect(sms.channel).toBe('sms');
    expect(sms.maskedTarget.startsWith('+63 ')).toBe(true);
    expect(sender.requests[1]!.to).toBe(PHONE);
    expect(sender.requests[1]!.message.startsWith('Gala Night: your photobooth photos are here ')).toBe(true);
  });

  it('keeps no address, number or token in the booth’s files', async () => {
    const { directory, sessionId } = setup({ token: 'abcdefghijklmnopqrstuv' });
    const sender = recordingSender();
    await sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender });
    await sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender });

    // The database file itself must not contain either target — not in a row, not in a setting.
    const bytes = fs.readFileSync(path.join(directory, 'photobooth.sqlite')).toString('latin1');
    expect(bytes).not.toContain(EMAIL);
    expect(bytes).not.toContain('maria.santos');
    expect(bytes).not.toContain(PHONE);
    expect(bytes).not.toContain('639171234567');
    const database = new Database(path.join(directory, 'photobooth.sqlite'), { readonly: true });
    try {
      const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
      const dump = tables.map((table) => JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all())).join('\n');
      expect(dump).not.toContain(EMAIL);
      expect(dump).not.toContain(PHONE);
    } finally { database.close(); }
    // Nothing on the settings side either.
    expect(fs.readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => fs.readFileSync(path.join(directory, file), 'utf8')).join('')).not.toContain(EMAIL);
  });

  it('refuses when the event turned sending off', async () => {
    const { directory, sessionId } = setup({ sendLinkEnabled: false });
    const sender = recordingSender();
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender }))
      .rejects.toThrow('Sending the link is turned off for this event');
    expect(sender.requests).toHaveLength(0);
  });

  it('refuses an unfinished session and a target that is not an address', async () => {
    const { directory, sessionId } = setup({ completed: false });
    const sender = recordingSender();
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender }))
      .rejects.toThrow('once the session is finished');
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: EMAIL, baseUrl: BASE_URL, sender }))
      .rejects.toThrow('digits only');
    await expect(sendSessionLink({ userDataPath: directory, sessionId: 'nope', channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender }))
      .rejects.toThrow('Invalid session');
    expect(sender.requests).toHaveLength(0);
  });

  it('reuses the link the QR code already shows, and mints one when there is none', async () => {
    const existing = setup({ token: 'abcdefghijklmnopqrstuv' });
    const sender = recordingSender();
    await sendSessionLink({ userDataPath: existing.directory, sessionId: existing.sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender });
    expect(sender.requests[0]!.link).toBe('https://photos.example.com/d/abcdefghijklmnopqrstuv');

    const fresh = setup();
    const freshSender = recordingSender();
    await sendSessionLink({ userDataPath: fresh.directory, sessionId: fresh.sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender: freshSender });
    expect(freshSender.requests[0]!.link).toMatch(/^https:\/\/photos\.example\.com\/d\/[A-Za-z0-9_-]{22}$/);
  });

  it('stops one guest turning the booth into an SMS machine', async () => {
    const { directory, sessionId } = setup();
    const sender = recordingSender();
    let clock = 1_700_000_000_000;
    const now = (): number => clock;
    for (let send = 0; send < MAX_SENDS_PER_SESSION; send += 1) {
      await sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender, now });
    }
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender, now }))
      .rejects.toThrow('Too many sends for this session');
    // Ten minutes later the guest may try again.
    clock += 10 * 60 * 1000;
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'sms', target: PHONE, baseUrl: BASE_URL, sender, now })).resolves.toBeDefined();
    expect(sender.requests).toHaveLength(MAX_SENDS_PER_SESSION + 1);
  });

  it('reports a sender that refused, without echoing the address', async () => {
    const { directory, sessionId } = setup();
    const refusing: LinkSender = { name: 'refusing', send: async () => ({ delivered: false, detail: 'The gateway refused the message (HTTP 500).' }) };
    const error: Error = await sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: EMAIL, baseUrl: BASE_URL, sender: refusing })
      .then(() => { throw new Error('expected the send to fail'); }, (caught: unknown) => caught as Error);
    expect(error.message).toBe('The gateway refused the message (HTTP 500).');
    expect(error.message).not.toContain(EMAIL);
  });

  it('explains why a link could not be built', async () => {
    const { directory, sessionId } = setup();
    const sender = recordingSender();
    await expect(sendSessionLink({ userDataPath: directory, sessionId, channel: 'email', target: EMAIL, baseUrl: 'http://photos.example.com', sender }))
      .rejects.toThrow('HTTPS');
    expect(sender.requests).toHaveLength(0);
  });

  it('the event switch is saved with the event', () => {
    const { directory, eventId } = setup({ sendLinkEnabled: false });
    const database = new Database(path.join(directory, 'photobooth.sqlite'));
    try {
      const row = database.prepare('SELECT send_link_enabled AS enabled FROM events WHERE id = ?').get(eventId) as { enabled: number };
      expect(row.enabled).toBe(0);
    } finally { database.close(); }
  });
});
