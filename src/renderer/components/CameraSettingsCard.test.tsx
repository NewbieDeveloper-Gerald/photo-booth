// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CameraSettingsCard } from './CameraSettingsCard';
import { EDSDK_DEVICE_PREFIX, EdsdkCameraDevice, MockCameraHostBridge } from '../../features/capture/camera/edsdk-camera';

const deviceId = `${EDSDK_DEVICE_PREFIX}0`;

function sink() {
  return () => ({ stream: { getTracks: () => [] } as unknown as MediaStream, push: async () => undefined, close: () => undefined });
}

describe('camera settings card (Phase 1)', () => {
  it('shows the host state and says what to do when it is missing', async () => {
    const bridge = new MockCameraHostBridge({ available: false, connected: false, restarts: 0, reason: 'The camera host is not installed.' });
    render(<CameraSettingsCard camera={new EdsdkCameraDevice(bridge, sink())} deviceId={deviceId} simulatedEnabled={false} busy={false} onToggleSimulated={() => {}} onNotice={() => {}} />);
    await waitFor(() => expect(screen.getByText('Host missing')).toBeDefined());
    expect(screen.getByText('The camera host is not installed.')).toBeDefined();
  });

  it('offers every control the body reports, separately for live view and capture', async () => {
    const bridge = new MockCameraHostBridge();
    render(<CameraSettingsCard camera={new EdsdkCameraDevice(bridge, sink())} deviceId={deviceId} simulatedEnabled={false} busy={false} onToggleSimulated={() => {}} onNotice={() => {}} />);
    const iso = await screen.findByLabelText('Capture ISO');
    expect((iso as HTMLSelectElement).value).toBe('100');
    expect(screen.getByLabelText('Live view ISO')).toBeDefined();
    expect(screen.getByLabelText('Capture Shutter speed')).toBeDefined();
    expect(screen.queryByLabelText('Live view Aperture')).toBeDefined();
  });

  it('sends a change to the camera for that role only, and reports what it kept', async () => {
    const bridge = new MockCameraHostBridge();
    const onNotice = vi.fn();
    render(<CameraSettingsCard camera={new EdsdkCameraDevice(bridge, sink())} deviceId={deviceId} simulatedEnabled={false} busy={false} onToggleSimulated={() => {}} onNotice={onNotice} />);
    const iso = await screen.findByLabelText('Live view ISO');
    fireEvent.change(iso, { target: { value: '3200' } });
    await waitFor(() => expect(bridge.applied).toEqual([{ role: 'liveView', settings: { iso: '3200' } }]));
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('focusses and fires on demand', async () => {
    const bridge = new MockCameraHostBridge();
    render(<CameraSettingsCard camera={new EdsdkCameraDevice(bridge, sink())} deviceId={deviceId} simulatedEnabled={false} busy={false} onToggleSimulated={() => {}} onNotice={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Autofocus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Test shutter' }));
    await waitFor(() => expect([bridge.focuses, bridge.shutters]).toEqual([1, 1]));
  });

  it('always offers the test camera, even with no DSLR connected', () => {
    const onToggleSimulated = vi.fn();
    render(<CameraSettingsCard camera={null} deviceId="webcam-1" simulatedEnabled={false} busy={false} onToggleSimulated={onToggleSimulated} onNotice={() => {}} />);
    fireEvent.click(screen.getByLabelText('Use the test camera'));
    expect(onToggleSimulated).toHaveBeenCalledWith(true);
  });
});
