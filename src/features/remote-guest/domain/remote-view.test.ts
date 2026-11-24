import { describe, expect, it } from 'vitest';
import {
  allowedRemoteCommands, buildRemoteView, isRemoteCommandAllowed, offRemoteView, parseRemoteCommand, remoteViewSignature,
  type RemoteViewInput,
} from './remote-view';

const base: RemoteViewInput = {
  boothScreen: 'ready',
  operatorWorking: false,
  consentOpen: false,
  paused: false,
  eventName: 'Ana & Ben',
  welcomeText: 'Welcome!',
  thankYouText: 'Thank you!',
  primaryColor: '#123456',
  accentColor: '#abcdef',
  logoUrl: '',
  layoutCount: 2,
  shotCount: 3,
  currentShot: 0,
  countdown: null,
  slots: [{ slotNumber: 1, photoId: 'photo-1' }, { slotNumber: 2, photoId: null }],
  shareUrl: '',
  consentText: 'Photos stay on the booth.',
  now: 1_000,
};
const input = (overrides: Partial<RemoteViewInput> = {}): RemoteViewInput => ({ ...base, ...overrides });

describe('the tablet view (F22)', () => {
  it('shows the start screen only when nobody is working on the booth', () => {
    expect(buildRemoteView(input())).toMatchObject({ stage: 'ready', message: 'Touch start when you are ready.' });
    expect(buildRemoteView(input({ operatorWorking: true }))).toMatchObject({ stage: 'busy', slots: [], countdown: null });
    expect(buildRemoteView(input({ operatorWorking: true, boothScreen: 'review' })).stage).toBe('busy');
  });

  it('explains a paused or consenting booth instead of showing a start button', () => {
    expect(buildRemoteView(input({ paused: true })).stage).toBe('paused');
    const consent = buildRemoteView(input({ paused: true, consentOpen: true }));
    expect(consent.consentText).toBe('Photos stay on the booth.');
    expect(buildRemoteView(input({ consentOpen: true })).stage).toBe('consent');
  });

  it('mirrors the shooting sequence with the countdown and the shot number', () => {
    const counting = buildRemoteView(input({ boothScreen: 'capturing', currentShot: 2, countdown: 3, shotCount: 4 }));
    expect(counting).toMatchObject({ stage: 'capturing', currentShot: 2, countdown: 3, shotCount: 4, message: 'Look at the camera!' });
    expect(buildRemoteView(input({ boothScreen: 'capturing', currentShot: 2, countdown: null })).message).toBe('Photo 2 of 3');
  });

  it('lists the finished photos for a retake, and says when they are ready', () => {
    const review = buildRemoteView(input({ boothScreen: 'review' }));
    expect(review.stage).toBe('review');
    expect(review.slots).toEqual([{ slotNumber: 1, filled: true }, { slotNumber: 2, filled: false }]);
    expect(buildRemoteView(input({ boothScreen: 'finished', shareUrl: 'https://x/y' })).message).toBe('Your photos are ready.');
    expect(buildRemoteView(input({ boothScreen: 'finished' })).message).toBe('Your photos are ready at the booth.');
  });

  it('turns the screen off in a way the tablet can read', () => {
    expect(offRemoteView(5)).toMatchObject({ stage: 'off', updatedAt: 5, slots: [] });
  });
});

describe('tablet commands (F22)', () => {
  it('accepts only the six guest commands, with a real slot number', () => {
    for (const type of ['start', 'consent', 'continue', 'done', 'reprint']) expect(parseRemoteCommand({ type })).toEqual({ type });
    expect(parseRemoteCommand({ type: 'retake', slotNumber: 2 }, 3)).toEqual({ type: 'retake', slotNumber: 2 });
    expect(parseRemoteCommand({ type: 'retake', slotNumber: 0 }, 3)).toBeNull();
    expect(parseRemoteCommand({ type: 'retake', slotNumber: 4 }, 3)).toBeNull();
    expect(parseRemoteCommand({ type: 'retake', slotNumber: 1.5 }, 3)).toBeNull();
    expect(parseRemoteCommand({ type: 'retake' }, 3)).toBeNull();
  });

  it('refuses anything that is not a known command', () => {
    expect(parseRemoteCommand(null)).toBeNull();
    expect(parseRemoteCommand('start')).toBeNull();
    expect(parseRemoteCommand({ type: 'delete-everything' })).toBeNull();
    expect(parseRemoteCommand({ type: 'set-admin-pin' })).toBeNull();
    expect(parseRemoteCommand({})).toBeNull();
  });

  it('lets each stage offer only its own commands', () => {
    const view = buildRemoteView(input({ boothScreen: 'review' }));
    expect(allowedRemoteCommands(view)).toEqual(['retake', 'continue']);
    expect(allowedRemoteCommands(buildRemoteView(input()))).toEqual(['start']);
    expect(allowedRemoteCommands(buildRemoteView(input({ operatorWorking: true })))).toEqual([]);
    expect(allowedRemoteCommands(buildRemoteView(input({ boothScreen: 'finished' })))).toEqual(['reprint', 'done']);
  });

  it('drops a command aimed at a stage the tablet is not in', () => {
    const ready = buildRemoteView(input());
    expect(isRemoteCommandAllowed(ready, { type: 'start' })).toBe(true);
    expect(isRemoteCommandAllowed(ready, { type: 'continue' })).toBe(false);
    expect(isRemoteCommandAllowed(ready, { type: 'retake', slotNumber: 1 })).toBe(false);
    const review = buildRemoteView(input({ boothScreen: 'review' }));
    expect(isRemoteCommandAllowed(review, { type: 'retake', slotNumber: 1 })).toBe(true);
    // A slot with no photo cannot be retaken, and a busy booth accepts nothing at all.
    expect(isRemoteCommandAllowed(review, { type: 'retake', slotNumber: 2 })).toBe(false);
    expect(isRemoteCommandAllowed(buildRemoteView(input({ operatorWorking: true })), { type: 'start' })).toBe(false);
  });

  it('only changes its signature when something the tablet shows changes', () => {
    const first = buildRemoteView(input({ now: 1 }));
    const later = buildRemoteView(input({ now: 9 }));
    expect(remoteViewSignature(first)).toBe(remoteViewSignature(later));
    expect(remoteViewSignature(first)).not.toBe(remoteViewSignature(buildRemoteView(input({ countdown: 3, boothScreen: 'capturing' }))));
  });
});
