/**
 * The tablet guest screen (F22). The booth owns everything that matters — camera, files,
 * printer, database — and broadcasts a deliberately small view to the tablet: what the guest
 * may see and tap, never an operator control, a PIN or a file path.
 */
export type RemoteStage = 'off' | 'busy' | 'ready' | 'consent' | 'capturing' | 'review' | 'finished' | 'paused';

export type RemoteSlot = {
  slotNumber: number;
  /** False while the slot is still waiting for its photo. */
  filled: boolean;
};

export type RemoteView = {
  stage: RemoteStage;
  eventName: string;
  welcomeText: string;
  thankYouText: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string;
  layoutCount: number;
  shotCount: number;
  /** 1-based slot being shot right now; 0 when nobody is posing. */
  currentShot: number;
  /** Seconds left in the countdown, null when not counting. */
  countdown: number | null;
  slots: RemoteSlot[];
  /** Public download link for the finished session, '' when the booth has none. */
  shareUrl: string;
  /** One line the guest should read, e.g. why the booth is busy. */
  message: string;
  /** The booth's consent notice, shown before the guest agrees. */
  consentText: string;
  updatedAt: number;
};

export type RemoteCommand =
  | { type: 'start' }
  | { type: 'consent' }
  | { type: 'retake'; slotNumber: number }
  | { type: 'continue' }
  | { type: 'done' }
  | { type: 'reprint' };

export type RemoteServerInfo = {
  /** False until the operator turns the tablet screen on. */
  enabled: boolean;
  /** Full URL to type on the tablet, null while the server has no LAN address. */
  url: string | null;
  clients: number;
};
