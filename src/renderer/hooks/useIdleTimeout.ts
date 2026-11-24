import { useCallback, useEffect, useRef, useState } from 'react';

type IdleTimeoutOptions = {
  timeoutMs: number;
  /** Only an in-progress session can time out; the ready screen never does. */
  enabled: boolean;
  onIdle: () => void;
};

export type IdleTimeoutControls = {
  /** Call after any operator action so the countdown restarts. */
  resetActivity: () => void;
};

/**
 * Abandons an in-progress session after `timeoutMs` without pointer or keyboard
 * input. The stored photos stay on disk, so timing out is always recoverable.
 */
export function useIdleTimeout({ timeoutMs, enabled, onIdle }: IdleTimeoutOptions): IdleTimeoutControls {
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const resetActivity = useCallback(() => setLastActivity(Date.now()), []);

  useEffect(() => {
    window.addEventListener('pointerdown', resetActivity);
    window.addEventListener('keydown', resetActivity);
    return () => {
      window.removeEventListener('pointerdown', resetActivity);
      window.removeEventListener('keydown', resetActivity);
    };
  }, [resetActivity]);

  useEffect(() => {
    if (!enabled) return undefined;
    const remaining = Math.max(0, timeoutMs - (Date.now() - lastActivity));
    const timer = window.setTimeout(() => onIdleRef.current(), remaining);
    return () => window.clearTimeout(timer);
  }, [enabled, lastActivity, timeoutMs]);

  return { resetActivity };
}
