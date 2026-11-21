import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserCameraDevice, type CameraInfo, type CameraResolution } from '../hardware/camera';
import './style.css';

const resolutionOptions: Array<{ value: CameraResolution; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '3840x2160', label: '4K · 3840 × 2160' },
];

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

function App(): React.JSX.Element {
  const camera = useMemo(() => typeof navigator !== 'undefined' && navigator.mediaDevices ? new BrowserCameraDevice() : null, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const startSequence = useRef(0);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [resolution, setResolution] = useState<CameraResolution>('best');
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState('Checking for cameras…');
  const [errorMessage, setErrorMessage] = useState('');
  const [actualResolution, setActualResolution] = useState('');

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = currentStream.current;
  }, [cameras, selectedCameraId, resolution]);

  const stopCurrentStream = useCallback(() => {
    startSequence.current += 1;
    camera?.stopPreview(currentStream.current);
    currentStream.current = null;
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
      setStatus('Camera is ready');
      const devices = await camera.listCameras();
      if (sequence === startSequence.current) setCameras(devices);
    } catch (error) {
      if (sequence !== startSequence.current) return;
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
      stopCurrentStream();
    };
    // The initial preference load should run once; device-change handling is installed separately.
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
    if (countdown === null) return undefined;
    const timer = window.setTimeout(() => {
      setCountdown((value) => value === null || value <= 1 ? null : value - 1);
      if (countdown === 1) setStatus('Countdown complete — photo capture comes in the next feature.');
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

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

  const runCountdown = (): void => {
    if (!currentStream.current) {
      setErrorMessage('Connect a camera before starting the countdown.');
      return;
    }
    setErrorMessage('');
    setCountdown(countdownSeconds);
    setStatus('Get ready…');
  };

  return (
    <main className="booth-app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PHOTOBOOTH <b>STUDIO</b></span></div>
        <div className="connection"><span className={`connection-dot ${currentStream.current ? 'online' : ''}`} />{status}</div>
      </header>
      <section className="workspace">
        <div className="stage-heading">
          <div><p className="eyebrow">CAMERA SETUP</p><h1>Frame the moment.</h1><p className="subheading">Choose a camera and check your framing before the session.</p></div>
          <div className="live-badge"><span /> LIVE PREVIEW</div>
        </div>
        <div className="preview-card">
          {currentStream.current ? <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="Mirrored live camera preview" /> : <div className="preview-empty"><div className="camera-glyph">◉</div><strong>{cameras.length ? 'Connecting to your camera…' : 'No camera preview yet'}</strong><span>Connect a webcam or select a camera below.</span></div>}
          {countdown !== null && <div className="countdown-overlay" aria-live="assertive"><span>{countdown}</span></div>}
          <div className="preview-meta"><span>{actualResolution || (currentStream.current ? 'Starting preview' : 'Waiting for camera')}</span><span className="mirror-label">MIRRORED</span></div>
        </div>
        <div className="controls-grid">
          <label className="control-field"><span>CAMERA</span><select value={selectedCameraId} onChange={(event) => void handleCameraChange(event.target.value)} disabled={!cameras.length}><option value="" disabled>Select a camera</option>{cameras.map((item, index) => <option key={item.deviceId || index} value={item.deviceId}>{item.label || `Camera ${index + 1}`}</option>)}</select></label>
          <label className="control-field"><span>PREVIEW QUALITY</span><select value={resolution} onChange={(event) => void handleResolutionChange(event.target.value as CameraResolution)}>{resolutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="control-field countdown-setting"><span>COUNTDOWN</span><select value={countdownSeconds} onChange={(event) => void handleCountdownChange(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 3).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          <button className="start-button" type="button" onClick={runCountdown} disabled={!currentStream.current || countdown !== null}>Start countdown <span aria-hidden="true">→</span></button>
        </div>
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}<button type="button" onClick={() => void refreshCameras()}>Retry</button></p>}
        {!errorMessage && <p className="helper-note">Your preview is local to this booth. Photos are not captured or saved in this step.</p>}
      </section>
      <footer className="app-footer"><span>OFFLINE-READY · PRIVATE BY DESIGN</span><span>CAMERA PREVIEW</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
