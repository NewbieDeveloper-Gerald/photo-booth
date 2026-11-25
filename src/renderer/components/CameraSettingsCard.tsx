import React, { useCallback, useEffect, useState } from 'react';
import {
  CAMERA_SETTING_IDS, CAMERA_SETTING_LABELS,
  type CameraCapabilities, type CameraSettingId, type CameraSettingRole, type CameraSettingsPair,
} from '../../features/capture/camera/camera-settings';
import { isEdsdkDeviceId, type EdsdkCameraDevice } from '../../features/capture/camera/edsdk-camera';
import type { CameraHostStatus } from '../../features/capture/camera/host-protocol';

type CameraSettingsCardProps = {
  /** The EDSDK camera, or null in the browser preview (no desktop bridge). */
  camera: EdsdkCameraDevice | null;
  deviceId: string;
  simulatedEnabled: boolean;
  busy: boolean;
  onToggleSimulated: (enabled: boolean) => void;
  onNotice: (message: string) => void;
};

const ROLE_LABELS: Record<CameraSettingRole, string> = { liveView: 'Live view', capture: 'Capture' };

/**
 * The DSLR controls (Phase 1): ISO, shutter, aperture, white balance and quality, set separately
 * for the preview and for the photo — a booth with strobes keeps the preview usable and the shot
 * clean. Everything is driven by what the body reports, so a camera without a control simply does
 * not show it.
 */
export function CameraSettingsCard({ camera, deviceId, simulatedEnabled, busy, onToggleSimulated, onNotice }: CameraSettingsCardProps): React.JSX.Element {
  const [status, setStatus] = useState<CameraHostStatus | null>(null);
  const [capabilities, setCapabilities] = useState<CameraCapabilities | null>(null);
  const [settings, setSettings] = useState<CameraSettingsPair | null>(null);
  const active = camera !== null && isEdsdkDeviceId(deviceId);

  useEffect(() => {
    let cancelled = false;
    if (!camera) { setStatus(null); return; }
    void camera.status().then((next) => { if (!cancelled) setStatus(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [camera]);

  useEffect(() => {
    let cancelled = false;
    if (!camera || !active) { setCapabilities(null); setSettings(null); return; }
    void Promise.all([camera.capabilities(deviceId), camera.settings(deviceId)])
      .then(([nextCapabilities, nextSettings]) => {
        if (cancelled) return;
        setCapabilities(nextCapabilities);
        setSettings(nextSettings);
      })
      .catch((error: unknown) => { if (!cancelled) onNotice(error instanceof Error ? error.message : 'The camera settings could not be read.'); });
    return () => { cancelled = true; };
  }, [camera, active, deviceId, onNotice]);

  const change = useCallback(async (role: CameraSettingRole, id: CameraSettingId, value: string): Promise<void> => {
    if (!camera) return;
    try {
      const result = await camera.applySettings(deviceId, role, { [id]: value });
      setSettings((current) => ({ liveView: current?.liveView ?? {}, capture: current?.capture ?? {}, [role]: { ...(current?.[role] ?? {}), ...result.applied } }));
      if (result.ignored.length > 0) onNotice(`The camera does not offer that ${CAMERA_SETTING_LABELS[id].toLowerCase()}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'The camera refused that setting.');
    }
  }, [camera, deviceId, onNotice]);

  const state = !status ? 'idle' : status.connected ? 'ready' : status.available ? 'restarting' : 'missing';
  const stateLabel = status?.reason ?? (active ? 'Live view and capture are set separately: a bright preview does not brighten the photo.'
    : 'Connect a DSLR, or switch on the test camera to rehearse the whole flow without hardware.');

  return (
    <section className="camera-settings-card" aria-label="Camera settings">
      <div className="camera-settings-heading">
        <div>
          <p className="eyebrow">CAMERA HOST</p>
          <h3>DSLR settings</h3>
        </div>
        <span className={`host-state ${state}`}>{state === 'ready' ? 'Host ready' : state === 'missing' ? 'Host missing' : state === 'restarting' ? 'Reconnecting' : 'Checking…'}</span>
      </div>
      <p className="gallery-hint">{stateLabel}</p>
      {active && capabilities && (
        <div className="camera-settings-grid">
          {(Object.keys(ROLE_LABELS) as CameraSettingRole[]).map((role) => (
            <fieldset key={role} className="camera-settings-group">
              <legend>{ROLE_LABELS[role]}</legend>
              {CAMERA_SETTING_IDS.map((id) => {
                const choices = capabilities[id];
                if (!choices || choices.length === 0) return null;
                const label = CAMERA_SETTING_LABELS[id];
                return (
                  <label key={id}>
                    {label}
                    <select
                      aria-label={`${ROLE_LABELS[role]} ${label}`}
                      value={settings?.[role]?.[id] ?? ''}
                      disabled={busy}
                      onChange={(event) => void change(role, id, event.target.value)}
                    >
                      <option value="" disabled>Ask the camera</option>
                      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                    </select>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="camera-settings-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void camera?.focus(deviceId).catch((error: unknown) => onNotice(error instanceof Error ? error.message : 'The camera could not focus.'))}>Autofocus</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void camera?.shutter(deviceId).catch((error: unknown) => onNotice(error instanceof Error ? error.message : 'The camera did not fire.'))}>Test shutter</button>
          </div>
        </div>
      )}
      <label className="attract-toggle">
        <input type="checkbox" aria-label="Use the test camera" checked={simulatedEnabled} onChange={(event) => onToggleSimulated(event.target.checked)} />
        <span>Use the test camera (rehearse with no hardware)</span>
      </label>
    </section>
  );
}
