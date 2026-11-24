// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttractScreen } from './AttractScreen';
import { templateFromCatalogPreset, getLayoutPreset } from '../../features/layouts';
import type { ActiveEvent } from '../../shared/types/event';
import type { AttractSlide } from '../lib/attract-slides';

const event: ActiveEvent = {
  id: 'event-1', name: 'Gala Night', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30, eventDate: null,
  logoPath: null, primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: 'Welcome to the gala',
  thankYouText: 'Thanks', defaultLayoutId: 'double-strip-3', offeredLayoutIds: ['double-strip-3'], consentText: '',
  contactText: '', galleryToken: null, galleryPasswordSet: false, watermarkEnabled: false, watermarkPosition: 'bottom-right',
  watermarkScalePercent: 18, watermarkOpacity: 0.6, printLimitPerSession: 2, paperCount: 0,
  attractEnabled: true, attractIdleSeconds: 60, filterId: 'none', filterChoiceEnabled: false, animatedOutput: 'gif', sendLinkEnabled: true,
};

const slide = (overrides: Partial<AttractSlide> = {}): AttractSlide =>
  ({ id: 'photo-1.png', kind: 'image', label: 'photo-1.png', url: 'blob:photo-1', ...overrides });

const layouts = [{ id: 'double-strip-3', label: 'Double strip', document: templateFromCatalogPreset(getLayoutPreset('double-strip-3')) }];

afterEach(() => { vi.useRealTimers(); });

describe('AttractScreen (F19)', () => {
  it('invites the guest in with the event name and its welcome text', () => {
    render(<AttractScreen event={event} logoDataUrl={null} slides={[]} layouts={layouts} onStart={() => {}} />);
    const overlay = screen.getByLabelText('Attract screen');
    expect(overlay.textContent).toContain('Gala Night');
    expect(overlay.textContent).toContain('Welcome to the gala');
    expect(screen.getByText('Touch to start')).toBeTruthy();
  });

  it('starts when the screen is touched or activated from the keyboard', () => {
    const onStart = vi.fn();
    render(<AttractScreen event={event} logoDataUrl={null} slides={[]} layouts={layouts} onStart={onStart} />);
    fireEvent.click(screen.getByLabelText('Attract screen'));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('Attract screen'), { key: 'Enter' });
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('shows the event logo when there is one', () => {
    render(<AttractScreen event={event} logoDataUrl="data:image/png;base64,abc" slides={[]} layouts={layouts} onStart={() => {}} />);
    expect(screen.getByLabelText('Attract screen').querySelector('.attract-logo')?.getAttribute('src')).toBe('data:image/png;base64,abc');
  });

  it('falls back to this event\u2019s layouts when no media is set', () => {
    render(<AttractScreen event={event} logoDataUrl={null} slides={[]} layouts={layouts} onStart={() => {}} />);
    expect(screen.getByLabelText('Double strip preview')).toBeTruthy();
  });

  it('plays a clip and advances the photo loop on the slide timer', () => {
    vi.useFakeTimers();
    const slides = [slide({ id: 'clip.mp4', kind: 'video', label: 'clip.mp4', url: 'blob:clip' }), slide({ id: 'photo-2.png', url: 'blob:photo-2' })];
    const { container } = render(<AttractScreen event={event} logoDataUrl={null} slides={slides} layouts={layouts} onStart={() => {}} />);
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe('blob:clip');
    expect(video?.hasAttribute('loop')).toBe(true);
    expect(screen.queryByText('Double strip preview')).toBeNull();
    act(() => { vi.advanceTimersByTime(5600); });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img[src="blob:photo-2"]')).toBeTruthy();
  });

  it('keeps one slide still when there is nothing to advance to', () => {
    vi.useFakeTimers();
    const { container } = render(<AttractScreen event={event} logoDataUrl={null} slides={[slide()]} layouts={layouts} onStart={() => {}} />);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(container.querySelector('img[src="blob:photo-1"]')).toBeTruthy();
  });
});
