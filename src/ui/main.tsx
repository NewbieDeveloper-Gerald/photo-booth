import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDownloadCopy, captureOriginalJpeg } from '../core/photo-pipeline';
import { BrowserCameraDevice, type CameraInfo, type CameraResolution } from '../hardware/camera';
import type { ActiveEvent, UnfinishedSession } from '../storage/sessions';
import './style.css';

const resolutionOptions: Array<{ value: CameraResolution; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '3840x2160', label: '4K · 3840 × 2160' },
];
type Screen = 'ready' | 'capturing' | 'complete';

async function getPreference(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution'): Promise<string | null> {
  if (window.photobooth) return window.photobooth.getSetting(key);
  return localStorage.getItem(`photobooth.${key}`);
}

async function savePreference(key: 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution', value: string): Promise<void> {
  if (window.photobooth) return window.photobooth.setSetting(key, value);
  localStorage.setItem(`photobooth.${key}`, value);
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied. Allow camera access in Windows Settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera matched that choice. Select another camera or resolution.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is disconnected or being used by another app. Close that app or reconnect the camera.';
  return 'The camera could not start. Check its connection and try again.';
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function bytesBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/jpeg' });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function App(): React.JSX.Element {
  const camera = useMemo(() => typeof navigator !== 'undefined' && navigator.mediaDevices ? new BrowserCameraDevice() : null, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const startSequence = useRef(0);
  const sequenceCancelled = useRef(false);
  const cancelCountdown = useRef<(() => void) | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [resolution, setResolution] = useState<CameraResolution>('best');
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState('Checking for cameras…');
  const [errorMessage, setErrorMessage] = useState('');
  const [actualResolution, setActualResolution] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [screen, setScreen] = useState<Screen>('ready');
  const [sessionId, setSessionId] = useState('');
  const [unfinishedSessions, setUnfinishedSessions] = useState<UnfinishedSession[]>([]);
  const [capturedSlots, setCapturedSlots] = useState<Set<number>>(new Set());
  const [currentSlot, setCurrentSlot] = useState(0);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const refreshUnfinishedSessions = useCallback(async (): Promise<void> => {
    if (!window.photobooth) return;
    try { setUnfinishedSessions(await window.photobooth.listUnfinishedSessions()); }
    catch { setErrorMessage('Could not load unfinished sessions. Your saved photos remain on disk.'); }
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = currentStream.current;
  }, [cameras, selectedCameraId, resolution, cameraReady]);

  const stopCurrentStream = useCallback(() => {
    startSequence.current += 1;
    camera?.stopPreview(currentStream.current);
    currentStream.current = null;
    setCameraReady(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [camera]);

  const startCamera = useCallback(async (deviceId: string, quality: CameraResolution): Promise<void> => {
    if (!camera) {
      setStatus('Camera access is not available in this environment.');
      return;
    }
    const sequence = ++startSequence.current;
    camera.stopPreview(currentStream.current);
    currentStream.current = null;
    setCameraReady(false);
    setErrorMessage('');
    setActualResolution('');
    setStatus('Connecting to camera…');

    try {
      const stream = await camera.startPreview(deviceId, quality);
      if (sequence !== startSequence.current) {
        camera.stopPreview(stream);
        return;
      }
      currentStream.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const settings = stream.getVideoTracks()[0]?.getSettings();
      if (settings?.width && settings.height) setActualResolution(`${settings.width} × ${settings.height}`);
      setCameraReady(true);
      setStatus('Camera is ready');
      const devices = await camera.listCameras();
      if (sequence === startSequence.current) setCameras(devices);
    } catch (error) {
      if (sequence !== startSequence.current) return;
      setCameraReady(false);
      setCountdown(null);
      setStatus('Camera unavailable');
      setErrorMessage(cameraErrorMessage(error));
      setCameras(await camera.listCameras().catch(() => []));
    }
  }, [camera]);

  const refreshCameras = useCallback(async () => {
    if (!camera) return;
    const devices = await camera.listCameras().catch(() => []);
    setCameras(devices);
    if (!selectedCameraId && devices.length) {
      const firstCamera = devices[0]!.deviceId;
      setSelectedCameraId(firstCamera);
      await savePreference('selectedCameraId', firstCamera).catch(() => undefined);
      await startCamera(firstCamera, resolution);
    } else if (selectedCameraId && !devices.some((item) => item.deviceId === selectedCameraId)) {
      stopCurrentStream();
      setCountdown(null);
      setStatus('Camera disconnected');
      setErrorMessage('Camera disconnected. Reconnect it to resume the preview.');
    } else if (selectedCameraId && !currentStream.current) {
      await startCamera(selectedCameraId, resolution);
    }
  }, [camera, resolution, selectedCameraId, startCamera, stopCurrentStream]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async (): Promise<void> => {
      const [savedCamera, savedCountdown, savedResolution] = await Promise.all([
        getPreference('selectedCameraId').catch(() => null),
        getPreference('countdownSeconds').catch(() => null),
        getPreference('cameraResolution').catch(() => null),
      ]);
      if (cancelled) return;
      const seconds = Number(savedCountdown);
      if (Number.isInteger(seconds) && seconds >= 3 && seconds <= 10) setCountdownSeconds(seconds);
      if (savedResolution && resolutionOptions.some((item) => item.value === savedResolution)) setResolution(savedResolution as CameraResolution);
      if (window.photobooth) {
        const [activeEvent] = await Promise.all([window.photobooth.getActiveEvent().catch(() => null), refreshUnfinishedSessions()]);
        if (cancelled) return;
        if (activeEvent) setEvent(activeEvent);
      } else {
        setEvent({ id: 'preview-event', name: 'Default Event', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30 });
      }
      if (!camera) {
        setStatus('Camera access is not available.');
        return;
      }
      const devices = await camera.listCameras().catch(() => []);
      if (cancelled) return;
      setCameras(devices);
      const chosen = savedCamera && devices.some((item) => item.deviceId === savedCamera) ? savedCamera : devices[0]?.deviceId ?? '';
      setSelectedCameraId(chosen);
      await startCamera(chosen, savedResolution && resolutionOptions.some((item) => item.value === savedResolution) ? savedResolution as CameraResolution : 'best');
    };
    void initialize();
    return () => {
      cancelled = true;
      sequenceCancelled.current = true;
      cancelCountdown.current?.();
      stopCurrentStream();
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
    // Initial preferences are loaded once; device changes are handled in a separate effect.
  }, []);

  useEffect(() => {
    const onDeviceChange = (): void => { void refreshCameras(); };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  }, [refreshCameras]);

  useEffect(() => {
    if (!errorMessage || !selectedCameraId || errorMessage.includes('permission')) return undefined;
    const retry = window.setInterval(() => {
      if (!currentStream.current) void startCamera(selectedCameraId, resolution);
    }, 5000);
    return () => window.clearInterval(retry);
  }, [errorMessage, resolution, selectedCameraId, startCamera]);

  useEffect(() => {
    const registerActivity = (): void => setLastActivity(Date.now());
    window.addEventListener('pointerdown', registerActivity);
    window.addEventListener('keydown', registerActivity);
    return () => {
      window.removeEventListener('pointerdown', registerActivity);
      window.removeEventListener('keydown', registerActivity);
    };
  }, []);

  const abandonForIdle = useCallback(async (activeSessionId: string): Promise<void> => {
    sequenceCancelled.current = true;
    cancelCountdown.current?.();
    setCountdown(null);
    try { await window.photobooth?.abandonSession(activeSessionId); }
    catch { setErrorMessage('Could not complete the backup. The session remains available to resume.'); }
    setSessionId('');
    setScreen('ready');
    setStatus('Session timed out; saved originals were backed up.');
    setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    await refreshUnfinishedSessions();
  }, [refreshUnfinishedSessions]);

  useEffect(() => {
    if (screen !== 'capturing' || !sessionId) return undefined;
    const remaining = Math.max(0, 90_000 - (Date.now() - lastActivity));
    const timer = window.setTimeout(() => { void abandonForIdle(sessionId); }, remaining);
    return () => window.clearTimeout(timer);
  }, [abandonForIdle, lastActivity, screen, sessionId]);

  const setPreviewImage = (blob: Blob): void => {
    setPhotoPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(blob);
    });
  };

  const runCountdown = async (): Promise<boolean> => {
    sequenceCancelled.current = false;
    for (let remaining = countdownSeconds; remaining >= 1; remaining -= 1) {
      if (sequenceCancelled.current) return false;
      setCountdown(remaining);
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => { cancelCountdown.current = null; resolve(); }, 1000);
        cancelCountdown.current = () => { window.clearTimeout(timer); cancelCountdown.current = null; resolve(); };
      });
    }
    setCountdown(null);
    return !sequenceCancelled.current;
  };

  const saveCapturedSlot = async (activeSessionId: string, slotNumber: number): Promise<void> => {
    const bridge = window.photobooth;
    const video = videoRef.current;
    if (!bridge || !video || !currentStream.current) throw new Error('The camera is not ready for capture.');

    const original = await captureOriginalJpeg(video);
    // Persist the full-resolution original before creating the reduced download copy.
    const record = await bridge.saveOriginalPhoto(activeSessionId, slotNumber, await blobBytes(original.blob), original.width, original.height);
    setCapturedSlots((current) => new Set(current).add(slotNumber));
    setPreviewImage(original.blob);
    setStatus(`Photo ${slotNumber} saved · making download copy…`);

    const download = await createDownloadCopy(original.blob);
    await bridge.saveDownloadCopy(record.photoId, await blobBytes(download.blob));
  };

  const captureSlots = async (activeSessionId: string, slots: number[]): Promise<void> => {
    sequenceCancelled.current = false;
    setScreen('capturing');
    for (const slotNumber of slots) {
      if (sequenceCancelled.current) return;
      setCurrentSlot(slotNumber);
      setStatus(`Get ready for photo ${slotNumber} of ${event?.shots ?? 3}…`);
      const countedDown = await runCountdown();
      if (!countedDown) return;
      try {
        await saveCapturedSlot(activeSessionId, slotNumber);
        setStatus(`Photo ${slotNumber} saved`);
        await wait(1300);
        if (sequenceCancelled.current) return;
        setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
      } catch (error) {
        sequenceCancelled.current = true;
        setCountdown(null);
        setScreen('ready');
        setStatus('Session paused · saved photos are safe');
        setErrorMessage(error instanceof Error ? error.message : 'Capture failed. Resume this session to continue.');
        setSessionId('');
            await refreshUnfinishedSessions();
        return;
      }
    }
    setScreen('complete');
    setCurrentSlot(0);
    setStatus('All photos saved');
    setSessionId('');
    await refreshUnfinishedSessions();
  };

  const handleStartSession = async (): Promise<void> => {
    if (!cameraReady || !window.photobooth) {
      setErrorMessage(!cameraReady ? 'Connect a camera before starting a session.' : 'Start a session in the desktop app.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    setCapturedSlots(new Set());
    try {
      const created = await window.photobooth.createSession();
      setEvent(created.event);
      setSessionId(created.sessionId);
      setScreen('capturing');
      setLastActivity(Date.now());
      await captureSlots(created.sessionId, Array.from({ length: created.event.shots }, (_, index) => index + 1));
    } catch (error) {
      setScreen('ready');
      setErrorMessage(error instanceof Error ? error.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  };

  const handleResumeSession = async (unfinished: UnfinishedSession): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge) return;
    setBusy(true);
    setErrorMessage('');
    sequenceCancelled.current = false;
    try {
      const saved = await bridge.loadSession(unfinished.id);
      setSessionId(saved.id);
      setScreen('capturing');
      setCapturedSlots(new Set(saved.slots.filter((slot) => slot.status === 'captured').map((slot) => slot.slotNumber)));
      setLastActivity(Date.now());

      for (const slot of saved.slots) {
        if (slot.photoId && !slot.downloadReady) {
          const originalBytes = await bridge.readOriginalPhoto(slot.photoId);
          const recoveredCopy = await createDownloadCopy(bytesBlob(originalBytes));
          await bridge.saveDownloadCopy(slot.photoId, await blobBytes(recoveredCopy.blob));
        }
      }
      const refreshed = await bridge.loadSession(saved.id);
      const missing = refreshed.slots.filter((slot) => !slot.photoId).map((slot) => slot.slotNumber);
      if (missing.length) await captureSlots(saved.id, missing);
      else {
        setScreen('complete');
        setSessionId('');
            setStatus('All photos saved');
        await refreshUnfinishedSessions();
      }
    } catch (error) {
      sequenceCancelled.current = true;
      setScreen('ready');
      setSessionId('');
        setErrorMessage(error instanceof Error ? error.message : 'Could not resume the session. Saved originals are safe.');
      await refreshUnfinishedSessions();
    } finally {
      setBusy(false);
    }
  };

  const handleDiscardSession = async (unfinished: UnfinishedSession): Promise<void> => {
    if (!window.photobooth) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await window.photobooth.discardSession(unfinished.id);
      setStatus('Session discarded; saved originals were backed up.');
      await refreshUnfinishedSessions();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not back up the session. It remains available.');
    } finally {
      setBusy(false);
    }
  };

  const handleCameraChange = async (deviceId: string): Promise<void> => {
    setSelectedCameraId(deviceId);
    await savePreference('selectedCameraId', deviceId).catch(() => setErrorMessage('Could not save the selected camera setting.'));
    await startCamera(deviceId, resolution);
  };
  const handleResolutionChange = async (value: CameraResolution): Promise<void> => {
    setResolution(value);
    await savePreference('cameraResolution', value).catch(() => setErrorMessage('Could not save the resolution setting.'));
    if (selectedCameraId) await startCamera(selectedCameraId, value);
  };
  const handleCountdownChange = async (value: number): Promise<void> => {
    setCountdownSeconds(value);
    await savePreference('countdownSeconds', String(value)).catch(() => setErrorMessage('Could not save the countdown setting.'));
  };

  const slotCount = event?.shots ?? 3;
  const isBusy = busy || screen === 'capturing';

  return (
    <main className="booth-app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PHOTOBOOTH <b>STUDIO</b></span></div>
        <div className="connection"><span className={`connection-dot ${cameraReady ? 'online' : ''}`} />{status}</div>
      </header>
      <section className="workspace">
        <div className="stage-heading">
          <div><p className="eyebrow">{screen === 'ready' ? 'PHOTO SESSION' : screen === 'capturing' ? 'SESSION IN PROGRESS' : 'SESSION COMPLETE'}</p><h1>{screen === 'ready' ? 'Frame the moment.' : screen === 'capturing' ? `Photo ${currentSlot} of ${slotCount}` : 'All set.'}</h1><p className="subheading">{screen === 'ready' ? `Ready for ${event?.name ?? 'your event'}. Check the preview, then start a session.` : screen === 'capturing' ? 'Stay in frame. Your original photo is saved before the download copy is prepared.' : 'Your three full-resolution originals and download copies are saved on this booth.'}</p></div>
          <div className="live-badge"><span /> {screen === 'capturing' ? 'CAPTURING' : 'LOCAL CAMERA'}</div>
        </div>
        <div className="preview-card">
          <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="Mirrored live camera preview" />
          {!cameraReady && <div className="preview-empty"><div className="camera-glyph">◉</div><strong>{cameras.length ? 'Connecting to your camera…' : 'No camera preview yet'}</strong><span>Connect a webcam or select a camera below.</span></div>}
          {photoPreviewUrl && <div className="captured-photo"><img src={photoPreviewUrl} alt={`Saved photo ${currentSlot}`} /><span>PHOTO {currentSlot} SAVED</span></div>}
          {countdown !== null && <div className="countdown-overlay" aria-live="assertive"><span>{countdown}</span></div>}
          <div className="preview-meta"><span>{actualResolution || (cameraReady ? 'Camera ready' : 'Waiting for camera')}</span><span className="mirror-label">MIRRORED</span></div>
        </div>
        <div className="controls-grid">
          <label className="control-field"><span>CAMERA</span><select value={selectedCameraId} onChange={(e) => void handleCameraChange(e.target.value)} disabled={isBusy || !cameras.length}><option value="" disabled>Select a camera</option>{cameras.map((item, index) => <option key={item.deviceId || index} value={item.deviceId}>{item.label || `Camera ${index + 1}`}</option>)}</select></label>
          <label className="control-field"><span>PREVIEW QUALITY</span><select value={resolution} onChange={(e) => void handleResolutionChange(e.target.value as CameraResolution)} disabled={isBusy}>{resolutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="control-field countdown-setting"><span>COUNTDOWN</span><select value={countdownSeconds} onChange={(e) => void handleCountdownChange(Number(e.target.value))} disabled={isBusy}>{Array.from({ length: 8 }, (_, index) => index + 3).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          {screen === 'complete' ? <button className="start-button" type="button" onClick={() => { setScreen('ready'); setStatus('Camera is ready'); setErrorMessage(''); }} disabled={!cameraReady}>Start another session <span aria-hidden="true">→</span></button>
            : <button className="start-button" type="button" onClick={() => void handleStartSession()} disabled={!cameraReady || !event || isBusy || unfinishedSessions.length > 0}>Start session <span aria-hidden="true">→</span></button>}
        </div>
        {screen === 'capturing' && <div className="slot-progress" aria-label="Photo slot progress">{Array.from({ length: slotCount }, (_, index) => index + 1).map((slot) => <div className={`slot-chip ${capturedSlots.has(slot) ? 'saved' : currentSlot === slot ? 'current' : ''}`} key={slot}><b>{String(slot).padStart(2, '0')}</b><span>{capturedSlots.has(slot) ? 'Saved' : currentSlot === slot ? 'Now' : 'Next'}</span></div>)}</div>}
        {unfinishedSessions.length > 0 && screen === 'ready' && <section className="recovery-card"><div><p className="eyebrow">UNFINISHED SESSION</p><strong>{unfinishedSessions[0]!.capturedSlots} of {unfinishedSessions[0]!.totalSlots} photos saved</strong><span>Your photos are safe on this booth. Resume where you left off or discard this session.</span></div><div className="recovery-actions"><button type="button" onClick={() => void handleResumeSession(unfinishedSessions[0]!)} disabled={busy || !cameraReady}>Resume</button><button type="button" className="secondary-button" onClick={() => void handleDiscardSession(unfinishedSessions[0]!)} disabled={busy}>Discard</button></div></section>}
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}<button type="button" onClick={() => void refreshCameras()}>Retry</button></p>}
        {!errorMessage && <p className="helper-note">Originals stay on this booth. No photos are uploaded in this feature.</p>}
      </section>
      <footer className="app-footer"><span>OFFLINE-READY · PRIVATE BY DESIGN</span><span>{event?.name.toUpperCase() ?? 'CAMERA SETUP'}</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
