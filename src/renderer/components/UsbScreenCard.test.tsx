// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsbScreenCard } from './UsbScreenCard';
import type { UsbLinkStatus } from '../../features/remote-guest';

type Props = React.ComponentProps<typeof UsbScreenCard>;

const status = (overrides: Partial<UsbLinkStatus> = {}): UsbLinkStatus => ({
  toolsAvailable: true, device: null, portForwarded: false, port: 47626, url: null,
  reason: 'Plug the phone or tablet into this computer with a USB cable.', devices: [], ...overrides,
});

const connectedStatus = status({
  device: 'R58M12345', portForwarded: true, reason: null,
  url: 'http://127.0.0.1:47626/remote/abcDEF1234567890_-xyZ/',
  devices: [{ serial: 'R58M12345', state: 'device', usb: true }],
});

function renderCard(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    status: status(), remoteEnabled: true, busy: false,
    onRefresh: vi.fn(), onConnect: vi.fn<Props['onConnect']>(async () => undefined),
    onDisconnect: vi.fn<Props['onDisconnect']>(async () => undefined), ...overrides,
  };
  render(<UsbScreenCard {...props} />);
  return props;
}

describe('UsbScreenCard (F22 extension)', () => {
  it('says there is no phone and why', () => {
    renderCard();
    const text = screen.getByLabelText('USB cable screen').textContent ?? '';
    expect(text).toContain('No phone on the cable');
    expect(text).toContain('Plug the phone or tablet');
    expect((screen.getByRole('button', { name: 'Connect over USB' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the trust prompt when the phone is not allowed yet', () => {
    renderCard({ status: status({ reason: 'The phone is connected but not trusted yet: unlock it and tap "Allow" on the "Allow USB debugging?" prompt.' }) });
    expect(screen.getByLabelText('USB cable screen').textContent).toContain('Allow USB debugging');
  });

  it('points at platform-tools when adb is missing', () => {
    renderCard({ status: status({ toolsAvailable: false, reason: 'The Android USB tools (adb) are not installed on this computer.' }) });
    const text = screen.getByLabelText('USB cable screen').textContent ?? '';
    expect(text).toContain('platform-tools');
    expect(text).toContain('not installed');
  });

  it('will not connect before the tablet screen is switched on', () => {
    renderCard({ status: status({ device: 'R58M12345', devices: [{ serial: 'R58M12345', state: 'device', usb: true }] }), remoteEnabled: false });
    const text = screen.getByLabelText('USB cable screen').textContent ?? '';
    expect(text).toContain('Switch on the tablet guest screen first');
    expect((screen.getByRole('button', { name: 'Connect over USB' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('maps the port and reports the localhost address', async () => {
    const props = renderCard({ status: status({ device: 'R58M12345', devices: [{ serial: 'R58M12345', state: 'device', usb: true }] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Connect over USB' }));
    await waitFor(() => expect(props.onConnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Screen opened on the phone over the cable.'));
  });

  it('shows the mapped address and closes the link again', async () => {
    const props = renderCard({ status: connectedStatus });
    expect(screen.getByLabelText('USB cable screen').textContent).toContain('Phone on the cable · R58M12345');
    expect((screen.getByLabelText('USB screen address') as HTMLInputElement).value).toBe('http://127.0.0.1:47626/remote/abcDEF1234567890_-xyZ/');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(props.onDisconnect).toHaveBeenCalledTimes(1));
  });

  it('reports a failure instead of claiming success', async () => {
    renderCard({
      status: status({ device: 'R58M12345', devices: [{ serial: 'R58M12345', state: 'device', usb: true }] }),
      onConnect: vi.fn<Props['onConnect']>(async () => { throw new Error('The Android tools refused to map the port.'); }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect over USB' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The Android tools refused to map the port.'));
  });
});
