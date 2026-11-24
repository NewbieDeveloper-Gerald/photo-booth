import React from 'react';
import { TETHER_MODEL, isTetherDeviceId, type TetherStatus } from '../../features/capture';

type CameraSourceCardProps = {
  status: TetherStatus | null;
  /** The camera the booth is shooting with right now. */
  selectedCameraId: string;
  busy?: boolean;
  onRefresh: () => void;
  onUseWebcam: () => void;
};

/**
 * The tether camera's state on the operator panel (F26). It answers the two questions that come
 * with a DSLR on a booth: is the helper seeing the camera, and which camera is the booth using?
 */
export function CameraSourceCard({ status, selectedCameraId, busy = false, onRefresh, onUseWebcam }: CameraSourceCardProps): React.JSX.Element {
  const shootingTether = isTetherDeviceId(selectedCameraId);
  const available = Boolean(status?.available);
  return (
    <section className="recovery-card camera-source-card" aria-label="Camera source">
      <div>
        <p className="eyebrow">CAMERA SOURCE</p>
        <strong>{shootingTether ? `${status?.model || TETHER_MODEL.label} · tethered` : 'Webcam'}</strong>
        <span>
          {available
            ? `${status!.model} is on the USB port. Photos are taken at the camera's own resolution; live view is a preview only.`
            : status?.reason ?? `Looking for a ${TETHER_MODEL.label} over the tether helper (${status?.helper ?? 'gphoto2'}).`}
        </span>
        {status && status.cameras.length > 0 && <span className="queue-note">Cameras seen: {status.cameras.join(', ')}</span>}
        {!available && <span className="queue-note">The booth keeps working on a webcam; nothing is lost while the camera is away.</span>}
      </div>
      <div className="remote-actions">
        <button type="button" className="secondary-button" onClick={onRefresh} disabled={busy}>Check camera</button>
        {shootingTether
          ? <button type="button" className="secondary-button" onClick={onUseWebcam} disabled={busy}>Use webcam instead</button>
          : <span className="queue-note">{available ? 'Choose the tether camera in the camera list.' : 'Using a webcam.'}</span>}
      </div>
    </section>
  );
}
