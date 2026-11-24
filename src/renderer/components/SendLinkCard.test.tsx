// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SendLinkCard } from './SendLinkCard';

type Props = React.ComponentProps<typeof SendLinkCard>;

const link = 'https://photos.example.com/d/abcdefghijklmnopqrstuv';

function renderCard(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    qrDataUrl: 'data:image/png;base64,qr', link, enabled: true, busy: false,
    onSend: vi.fn<Props['onSend']>(async (channel) => ({ channel, maskedTarget: 'm•••@example.com', detail: 'Sent.' })),
    ...overrides,
  };
  render(<SendLinkCard {...props} />);
  return props;
}

const calls = (fn: unknown): unknown[][] => (fn as { mock: { calls: unknown[][] } }).mock.calls;

describe('SendLinkCard (F28)', () => {
  it('keeps the QR code and the link on screen while the guest types', () => {
    renderCard();
    const card = screen.getByLabelText('Send the link');
    expect(screen.getByAltText('QR code for the guest download link').getAttribute('src')).toBe('data:image/png;base64,qr');
    expect((screen.getByLabelText('Guest link') as HTMLInputElement).value).toBe(link);
    expect(card.textContent).toContain('no address or number is stored');
  });

  it('sends by email by default and reports a masked confirmation', async () => {
    const props = renderCard();
    fireEvent.change(screen.getByLabelText('Send the link to'), { target: { value: 'maria@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(props.onSend).toHaveBeenCalledWith('email', 'maria@example.com'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sent to m•••@example.com · Sent.'));
    // The typed address does not stay on screen once it is sent.
    expect((screen.getByLabelText('Send the link to') as HTMLInputElement).value).toBe('');
  });

  it('switches to SMS, which changes the field and the buttons’ state', async () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    const input = screen.getByLabelText('Send the link to') as HTMLInputElement;
    expect(input.type).toBe('tel');
    expect(input.placeholder).toBe('+63 917 123 4567');
    expect((screen.getByRole('button', { name: 'Send link' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '+63 917 123 4567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(calls(props.onSend)[0]).toEqual(['sms', '+63 917 123 4567']));
  });

  it('shows the refusal the booth gave, and keeps the typed value to retry', async () => {
    const props = renderCard({ onSend: vi.fn<Props['onSend']>(async () => { throw new Error('That does not look like an email address'); }) });
    fireEvent.change(screen.getByLabelText('Send the link to'), { target: { value: 'maria@example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That does not look like an email address'));
    expect((screen.getByLabelText('Send the link to') as HTMLInputElement).value).toBe('maria@example');
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to send when the event turned it off', () => {
    renderCard({ enabled: false });
    expect(screen.getByLabelText('Send the link').textContent).toContain('Sending the link is turned off for this event');
    expect((screen.getByLabelText('Send the link to') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send link' }) as HTMLButtonElement).disabled).toBe(true);
    // The QR code is still there, because scanning is always available.
    expect(screen.getByAltText('QR code for the guest download link')).toBeDefined();
  });
});
