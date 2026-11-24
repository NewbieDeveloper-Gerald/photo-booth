// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CameraSourceCard } from './CameraSourceCard';
import { TETHER_MODEL } from '../../features/capture';

const available = { available: true, helper: 'gphoto2', model: TETHER_MODEL.label, cameras: [TETHER_MODEL.label], reason: null };

describe('CameraSourceCard (F26)', () => {
  it('says the tether camera is on the port and how photos are taken', () => {
    render(<CameraSourceCard status={available} selectedCameraId={TETHER_MODEL.deviceId} onRefresh={() => {}} onUseWebcam={() => {}} />);
    const text = screen.getByLabelText('Camera source').textContent ?? '';
    expect(text).toContain('Canon EOS 250D · tethered');
    expect(text).toContain('camera\'s own resolution');
    expect(text).toContain(`Cameras seen: ${TETHER_MODEL.label}`);
    expect(screen.getByRole('button', { name: 'Use webcam instead' })).toBeDefined();
  });

  it('shows why the camera is missing and offers a re-check', () => {
    const onRefresh = vi.fn();
    render(<CameraSourceCard status={{ available: false, helper: 'gphoto2', model: TETHER_MODEL.label, cameras: [], reason: 'No Canon EOS 250D was found. Check the USB cable.' }}
      selectedCameraId="webcam-1" onRefresh={onRefresh} onUseWebcam={() => {}} />);
    const text = screen.getByLabelText('Camera source').textContent ?? '';
    expect(text).toContain('Webcam');
    expect(text).toContain('No Canon EOS 250D was found');
    expect(text).toContain('keeps working on a webcam');
    expect(text).toContain('Using a webcam.');
    fireEvent.click(screen.getByRole('button', { name: 'Check camera' }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('switches back to a webcam on request', () => {
    const onUseWebcam = vi.fn();
    render(<CameraSourceCard status={available} selectedCameraId={TETHER_MODEL.deviceId} onRefresh={() => {}} onUseWebcam={onUseWebcam} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use webcam instead' }));
    expect(onUseWebcam).toHaveBeenCalled();
  });

  it('has something to say before the first check finishes', () => {
    render(<CameraSourceCard status={null} selectedCameraId="" onRefresh={() => {}} onUseWebcam={() => {}} />);
    expect(screen.getByLabelText('Camera source').textContent).toContain('tether helper (gphoto2)');
  });
});
