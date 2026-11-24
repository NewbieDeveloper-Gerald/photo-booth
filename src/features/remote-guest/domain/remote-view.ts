import type { RemoteCommand, RemoteStage, RemoteView } from '../../../shared/types/remote-guest';

/** Everything the booth knows that the tablet is allowed to see something of. */
export type RemoteViewInput = {
  boothScreen: 'ready' | 'capturing' | 'review' | 'finished';
  /** True while the operator has the settings unlocked: the booth is being worked on. */
  operatorWorking: boolean;
  consentOpen: boolean;
  paused: boolean;
  eventName: string;
  welcomeText: string;
  thankYouText: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  layoutCount: number;
  shotCount: number;
  currentShot: number;
  countdown: number | null;
  slots: Array<{ slotNumber: number; photoId: string | null }>;
  shareUrl: string;
  consentText: string;
  now: number;
};

/**
 * What the tablet shows (F22). The booth screen wins every time: a session that paused, an
 * operator with the settings open, or a finished session all read as a stage the tablet can
 * explain, and the tablet never invents a stage of its own.
 */
export function buildRemoteView(input: RemoteViewInput): RemoteView {
  const base = {
    eventName: input.eventName,
    welcomeText: input.welcomeText,
    thankYouText: input.thankYouText,
    primaryColor: input.primaryColor,
    accentColor: input.accentColor,
    logoUrl: input.logoUrl,
    layoutCount: input.layoutCount,
    shotCount: input.shotCount,
    shareUrl: input.shareUrl,
    consentText: input.consentText,
    updatedAt: input.now,
  };
  if (input.operatorWorking) {
    return { ...base, stage: 'busy', currentShot: 0, countdown: null, slots: [], message: 'The booth is being set up. Please wait a moment.' };
  }
  if (input.paused) {
    return { ...base, stage: 'paused', currentShot: 0, countdown: null, slots: [], message: 'The booth is paused. Ask the operator to continue.' };
  }
  if (input.consentOpen) {
    return { ...base, stage: 'consent', currentShot: 0, countdown: null, slots: [], message: 'Read the notice, then agree to start.' };
  }
  switch (input.boothScreen) {
    case 'capturing':
      return {
        ...base, stage: 'capturing', currentShot: input.currentShot, countdown: input.countdown, slots: [],
        message: input.countdown === null ? `Photo ${input.currentShot} of ${input.shotCount}` : 'Look at the camera!',
      };
    case 'review':
      return {
        ...base, stage: 'review', currentShot: 0, countdown: null,
        slots: input.slots.map((slot) => ({ slotNumber: slot.slotNumber, filled: Boolean(slot.photoId) })),
        message: 'Happy with the photos?',
      };
    case 'finished':
      return { ...base, stage: 'finished', currentShot: 0, countdown: null, slots: [], message: input.shareUrl ? 'Your photos are ready.' : 'Your photos are ready at the booth.' };
    default:
      return { ...base, stage: 'ready', currentShot: 0, countdown: null, slots: [], message: 'Touch start when you are ready.' };
  }
}

/** The stage the operator switched the screen off for (server answers it without a view). */
export function offRemoteView(now: number): RemoteView {
  return {
    stage: 'off', eventName: '', welcomeText: '', thankYouText: '', primaryColor: '', accentColor: '', logoUrl: '',
    layoutCount: 0, shotCount: 0, currentShot: 0, countdown: null, slots: [], shareUrl: '', consentText: '',
    message: 'The tablet screen is switched off on the booth.', updatedAt: now,
  };
}

const COMMAND_TYPES = ['start', 'consent', 'retake', 'continue', 'done', 'reprint'] as const;

/**
 * Parses one command from the tablet. Unknown types, extra fields and impossible slot numbers
 * are dropped here, so the tablet cannot talk the booth into anything the UI does not offer.
 */
export function parseRemoteCommand(raw: unknown, shotCount = 6): RemoteCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(candidate.type)) return null;
  if (candidate.type === 'retake') {
    const slotNumber = candidate.slotNumber;
    if (typeof slotNumber !== 'number' || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > shotCount) return null;
    return { type: 'retake', slotNumber };
  }
  return { type: candidate.type as Exclude<RemoteCommand['type'], 'retake'> };
}

/** Which commands the tablet may send in the stage it is showing. */
export function allowedRemoteCommands(view: RemoteView): RemoteCommand['type'][] {
  switch (view.stage) {
    case 'ready': return ['start'];
    case 'consent': return ['consent'];
    case 'review': return ['retake', 'continue'];
    case 'finished': return ['reprint', 'done'];
    default: return [];
  }
}

/** The gate the booth applies before acting on a tablet command: the stage decides. */
export function isRemoteCommandAllowed(view: RemoteView, command: RemoteCommand): boolean {
  if (command.type === 'retake') {
    if (view.stage !== 'review') return false;
    return view.slots.some((slot) => slot.slotNumber === command.slotNumber && slot.filled);
  }
  return allowedRemoteCommands(view).includes(command.type);
}

/** Cheap change detection: the booth only broadcasts when this string changes. */
export function remoteViewSignature(view: RemoteView): string {
  const baseline = {
    stage: view.stage, eventName: view.eventName, welcomeText: view.welcomeText, thankYouText: view.thankYouText,
    primaryColor: view.primaryColor, accentColor: view.accentColor, logoUrl: view.logoUrl, layoutCount: view.layoutCount,
    shotCount: view.shotCount, currentShot: view.currentShot, countdown: view.countdown, slots: view.slots,
    shareUrl: view.shareUrl, message: view.message, consentText: view.consentText,
  };
  return JSON.stringify(baseline);
}

export type { RemoteStage };
