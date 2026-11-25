import { describe, expect, it } from 'vitest';
import {
  defaultsFromCapabilities, hasAnyCapability, pickSupported, unsupportedSettings,
  type CameraCapabilities,
} from './camera-settings';

const capabilities: CameraCapabilities = {
  iso: [{ value: '100', label: '100' }, { value: '3200', label: '3200' }],
  shutter: [{ value: '1/250', label: '1/250' }],
  quality: [{ value: 'jpeg-large', label: 'Large JPEG' }],
};

describe('camera settings', () => {
  it('sends only what the camera offers, so a stale preference cannot reach a new body', () => {
    expect(pickSupported(capabilities, { iso: '3200', aperture: 'f/8', shutter: '1/250', whiteBalance: 'Auto' }))
      .toEqual({ iso: '3200', shutter: '1/250' });
  });

  it('names the settings it had to drop', () => {
    expect(unsupportedSettings(capabilities, { iso: '3200', aperture: 'f/8' })).toEqual(['aperture']);
  });

  it('starts from the camera’s own first choice rather than a number the booth invented', () => {
    expect(defaultsFromCapabilities(capabilities)).toEqual({ iso: '100', shutter: '1/250', quality: 'jpeg-large' });
  });

  it('says when a camera has no settable control at all', () => {
    expect(hasAnyCapability(capabilities)).toBe(true);
    expect(hasAnyCapability({ iso: [] })).toBe(false);
    expect(hasAnyCapability({})).toBe(false);
  });

  it('keeps live view and capture independent: a bright preview is not a bright photo', () => {
    const liveView = pickSupported(capabilities, { iso: '3200' });
    const capture = pickSupported(capabilities, { iso: '100' });
    expect(liveView).toEqual({ iso: '3200' });
    expect(capture).toEqual({ iso: '100' });
  });
});
