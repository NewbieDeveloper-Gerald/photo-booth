import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { canRetake, isValidRetakeLimit, retakesRemaining } from '../core/retakes';
import { captureOriginalJpeg } from '../core/photo-pipeline';
import { coverCrop } from '../core/layout';
import template from '../../templates/default-4x6.json';
import { BrowserCameraDevice, type CameraInfo, type CameraResolution } from '../hardware/camera';
import type { ActiveEvent, SessionRecord, SessionSlot, UnfinishedSession } from '../storage/sessions';
import './style.css';

const resolutionOptions: Array<{ value: CameraResolution; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '3840x2160', label: '4K · 3840 × 2160' },
];
type Screen = 'ready' | 'capturing' | 'review' | 'finished';
type ReviewImage = { slotNumber: number; photoId: string; url: string };

type PreferenceKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB';
async function getPreference(key: PreferenceKey): Promise<string | null> {
  if (window.photobooth) return window.photobooth.getSetting(key);
  return localStorage.getItem(`photobooth.${key}`);
}
async function savePreference(key: PreferenceKey, value: string): Promise<void> {
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
function blobBytes(blob: Blob): Promise<Uint8Array> { return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer)); }
function bytesBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/jpeg' });
}
function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

async function renderFinishedLayout(record: SessionRecord, eventName: string): Promise<Blob> {
  const bridge = window.photobooth;
  if (!bridge) throw new Error('Finished layouts are available in the desktop app.');
  const canvas = document.createElement('canvas');
  canvas.width = template.width;
  canvas.height = template.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the finished layout.');
  context.fillStyle = template.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = template.header.color;
  context.font = `600 ${template.header.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(template.header.text.replace('{{eventName}}', eventName), template.header.x + template.header.width / 2,
    template.header.y + template.header.height / 2, template.header.width);

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const region of template.photoSlots) {
      const slot = record.slots.find((item) => item.slotNumber === region.slot);
      if (!slot?.photoId) throw new Error(`Photo ${region.slot} is missing from this session.`);
      const bitmap = await createImageBitmap(bytesBlob(await bridge.readOriginalPhoto(slot.photoId)));
      bitmaps.push(bitmap);
      const crop = coverCrop(bitmap.width, bitmap.height, region.width, region.height);
      context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, region.x, region.y, region.width, region.height);
    }
  } finally { for (const bitmap of bitmaps) bitmap.close(); }

  const qr = template.qrPlaceholder;
  context.save();
  context.strokeStyle = '#9b94a2';
  context.lineWidth = 3;
  context.setLineDash([12, 9]);
  context.strokeRect(qr.x, qr.y, qr.width, qr.height);
  context.setLineDash([]);
  context.fillStyle = '#817a88';
  context.font = '600 22px Inter, Segoe UI, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(qr.label, qr.x + qr.width / 2, qr.y + qr.height / 2);
  context.restore();
  context.fillStyle = template.footer.color;
  context.font = `500 ${template.footer.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(template.footer.text, template.footer.x, template.footer.y + template.footer.height / 2, template.footer.width);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the finished layout.')), 'image/jpeg', 0.96));
}

function App(): React.JSX.Element {
  const camera = useMemo(() => typeof navigator !== 'undefined' && navigator.mediaDevices ? new BrowserCameraDevice() : null, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentStream = useRef<MediaStream | null>(null);
  const startSequence = useRef(0);
  const sequenceCancelled = useRef(false);
  const cancelCountdown = useRef<(() => void) | null>(null);
  const reviewUrls = useRef<string[]>([]);
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
  const [retakeLimitDraft, setRetakeLimitDraft] = useState('3');
  const [diskWarningGB, setDiskWarningGB] = useState('2');
  const [screen, setScreen] = useState<Screen>('ready');
  const [sessionId, setSessionId] = useState('');
  const [reviewRecord, setReviewRecord] = useState<SessionRecord | null>(null);
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [finalOutputUrl, setFinalOutputUrl] = useState('');
  const [unfinishedSessions, setUnfinishedSessions] = useState<UnfinishedSession[]>([]);
  const [capturedSlots, setCapturedSlots] = useState<Set<number>>(new Set());
  const [currentSlot, setCurrentSlot] = useState(0);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [retakeBusySlot, setRetakeBusySlot] = useState<number | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const clearReviewUrls = useCallback(() => {
    for (const url of reviewUrls.current) URL.revokeObjectURL(url);
    reviewUrls.current = [];
  }, []);

  const refreshUnfinishedSessions = useCallback(async (): Promise<void> => {
    if (!window.photobooth) return;
    try { setUnfinishedSessions(await window.photobooth.listUnfinishedSessions()); }
    catch { setErrorMessage('Could not load unfinished sessions. Your saved photos remain on disk.'); }
  }, []);

  const loadReviewSession = useCallback(async (activeSessionId: string): Promise<SessionRecord> => {
    const bridge = window.photobooth;
    if (!bridge) throw new Error('Session review is available in the desktop app.');
    const record = await bridge.loadSession(activeSessionId);
    const createdUrls: ReviewImage[] = [];
    try {
      for (const slot of record.slots) {
        if (!slot.photoId) continue;
        const bytes = await bridge.readOriginalPhoto(slot.photoId);
        createdUrls.push({ slotNumber: slot.slotNumber, photoId: slot.photoId, url: URL.createObjectURL(bytesBlob(bytes)) });
      }
    } catch (error) {
      for (const image of createdUrls) URL.revokeObjectURL(image.url);
      throw error;
    }
    clearReviewUrls();
    reviewUrls.current = createdUrls.map((image) => image.url);
    setReviewRecord(record);
    setReviewImages(createdUrls);
    return record;
  }, [clearReviewUrls]);

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
    if (!camera) { setStatus('Camera access is not available in this environment.'); return; }
    const sequence = ++startSequence.current;
    camera.stopPreview(currentStream.current);
    currentStream.current = null;
    setCameraReady(false);
    setErrorMessage('');
    setActualResolution('');
    setStatus('Connecting to camera…');
    try {
      const stream = await camera.startPreview(deviceId, quality);
      if (sequence !== startSequence.current) { camera.stopPreview(stream); return; }
      currentStream.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
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
      const [savedCamera, savedCountdown, savedResolution, savedDiskWarning] = await Promise.all([
        getPreference('selectedCameraId').catch(() => null),
        getPreference('countdownSeconds').catch(() => null),
        getPreference('cameraResolution').catch(() => null),
        getPreference('lowDiskWarningGB').catch(() => null),
      ]);
      if (savedDiskWarning !== null && Number.isFinite(Number(savedDiskWarning)) && Number(savedDiskWarning) >= 0 && Number(savedDiskWarning) <= 1000) setDiskWarningGB(savedDiskWarning);
      if (cancelled) return;
      const seconds = Number(savedCountdown);
      if (Number.isInteger(seconds) && seconds >= 3 && seconds <= 10) setCountdownSeconds(seconds);
      if (savedResolution && resolutionOptions.some((item) => item.value === savedResolution)) setResolution(savedResolution as CameraResolution);
      if (window.photobooth) {
        const [activeEvent] = await Promise.all([window.photobooth.getActiveEvent().catch(() => null), refreshUnfinishedSessions()]);
        if (cancelled) return;
        if (activeEvent) {
          setEvent(activeEvent);
          setRetakeLimitDraft(activeEvent.retakeLimit === -1 ? '' : String(activeEvent.retakeLimit));
        }
      } else {
        setEvent({ id: 'preview-event', name: 'Default Event', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30 });
        setRetakeLimitDraft('3');
      }
      if (!camera) { setStatus('Camera access is not available.'); return; }
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
      if (finalOutputUrl) URL.revokeObjectURL(finalOutputUrl);
      clearReviewUrls();
    };
    // Initial preferences load once; camera and session changes are handled separately.
  }, []);

  useEffect(() => {
    const onDeviceChange = (): void => { void refreshCameras(); };
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
  }, [refreshCameras]);

  useEffect(() => {
    if (!errorMessage || !selectedCameraId || errorMessage.includes('permission')) return undefined;
    const retry = window.setInterval(() => { if (!currentStream.current) void startCamera(selectedCameraId, resolution); }, 5000);
    return () => window.clearInterval(retry);
  }, [errorMessage, resolution, selectedCameraId, startCamera]);

  useEffect(() => {
    const registerActivity = (): void => setLastActivity(Date.now());
    window.addEventListener('pointerdown', registerActivity);
    window.addEventListener('keydown', registerActivity);
    return () => { window.removeEventListener('pointerdown', registerActivity); window.removeEventListener('keydown', registerActivity); };
  }, []);

  const abandonForIdle = useCallback(async (activeSessionId: string): Promise<void> => {
    sequenceCancelled.current = true;
    cancelCountdown.current?.();
    setCountdown(null);
    try { await window.photobooth?.abandonSession(activeSessionId); }
    catch { setErrorMessage('Could not complete the backup. The session remains available to resume.'); }
    setSessionId('');
    setReviewRecord(null);
    clearReviewUrls();
    setScreen('ready');
    setStatus('Session timed out; saved originals were backed up.');
    setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    await refreshUnfinishedSessions();
  }, [clearReviewUrls, refreshUnfinishedSessions]);

  useEffect(() => {
    if ((screen !== 'capturing' && screen !== 'review') || !sessionId || retakeBusySlot !== null) return undefined;
    const remaining = Math.max(0, 90_000 - (Date.now() - lastActivity));
    const timer = window.setTimeout(() => { void abandonForIdle(sessionId); }, remaining);
    return () => window.clearTimeout(timer);
  }, [abandonForIdle, lastActivity, retakeBusySlot, screen, sessionId]);

  const setPreviewImage = (blob: Blob): void => {
    setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
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
    await bridge.saveOriginalPhoto(activeSessionId, slotNumber, await blobBytes(original.blob), original.width, original.height);
    setCapturedSlots((current) => new Set(current).add(slotNumber));
    setPreviewImage(original.blob);
    setStatus(`Photo ${slotNumber} saved.`);
  };

  const captureSlots = async (activeSessionId: string, slots: number[], totalSlots: number): Promise<void> => {
    sequenceCancelled.current = false;
    setScreen('capturing');
    for (const slotNumber of slots) {
      if (sequenceCancelled.current) return;
      setCurrentSlot(slotNumber);
      setStatus(`Get ready for photo ${slotNumber} of ${totalSlots}…`);
      if (!await runCountdown()) return;
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
    setCurrentSlot(0);
    setStatus('Review your photos');
    setScreen('review');
    setLastActivity(Date.now());
    await loadReviewSession(activeSessionId);
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
    clearReviewUrls();
    try {
      if (!await window.photobooth.checkDiskSpace(Number(diskWarningGB))) return;
      const created = await window.photobooth.createSession();
      setEvent(created.event);
      setSessionId(created.sessionId);
      setScreen('capturing');
      setLastActivity(Date.now());
      await captureSlots(created.sessionId, Array.from({ length: created.event.shots }, (_, index) => index + 1), created.event.shots);
    } catch (error) {
      setScreen('ready');
      setErrorMessage(error instanceof Error ? error.message : 'Could not start the session.');
    } finally { setBusy(false); }
  };

  const finishPendingRetake = async (activeSessionId: string, slot: SessionSlot): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !slot.pendingPhotoId) return;
    await bridge.commitRetake(activeSessionId, slot.slotNumber, slot.pendingPhotoId);
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
      setLastActivity(Date.now());
      if (saved.status === 'completed') {
        setScreen('review');
        const pendingRetakes = saved.slots.filter((slot) => slot.pendingPhotoId);
        if (pendingRetakes.length) setRetakeBusySlot(pendingRetakes[0]!.slotNumber);
        for (const slot of pendingRetakes) await finishPendingRetake(saved.id, slot);
        setRetakeBusySlot(null);
        setLastActivity(Date.now());
        await loadReviewSession(saved.id);
        await refreshUnfinishedSessions();
        return;
      }
      setScreen('capturing');
      setCapturedSlots(new Set(saved.slots.filter((slot) => slot.status === 'captured').map((slot) => slot.slotNumber)));
      const refreshed = await bridge.loadSession(saved.id);
      const missing = refreshed.slots.filter((slot) => !slot.photoId).map((slot) => slot.slotNumber);
      if (missing.length) await captureSlots(saved.id, missing, refreshed.slots.length);
      else {
        setCurrentSlot(0);
        setScreen('review');
        setStatus('Review your photos');
        await loadReviewSession(saved.id);
        await refreshUnfinishedSessions();
      }
    } catch (error) {
      sequenceCancelled.current = true;
      setRetakeBusySlot(null);
      setScreen('ready');
      setSessionId('');
      setErrorMessage(error instanceof Error ? error.message : 'Could not resume the session. Saved originals are safe.');
      await refreshUnfinishedSessions();
    } finally { setBusy(false); }
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
    } finally { setBusy(false); }
  };

  const handleRetake = async (slot: SessionSlot): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !sessionId || !reviewRecord || !cameraReady) return;
    if (slot.pendingPhotoId) {
      setBusy(true);
      setRetakeBusySlot(slot.slotNumber);
      try {
        await finishPendingRetake(sessionId, slot);
        setLastActivity(Date.now());
        await loadReviewSession(sessionId);
        await refreshUnfinishedSessions();
      } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Could not finish the saved retake.'); }
      finally { setRetakeBusySlot(null); setBusy(false); }
      return;
    }
    if (!canRetake(reviewRecord.retakeLimit, reviewRecord.retakesUsed)) return;
    setRetakeBusySlot(slot.slotNumber);
    setCurrentSlot(slot.slotNumber);
    setErrorMessage('');
    try {
      setStatus(`Get ready to retake photo ${slot.slotNumber}…`);
      if (!await runCountdown()) return;
      const video = videoRef.current;
      if (!video || !currentStream.current) throw new Error('The camera is not ready for capture.');
      const original = await captureOriginalJpeg(video);
      const pending = await bridge.saveRetakeOriginalPhoto(sessionId, slot.slotNumber, await blobBytes(original.blob), original.width, original.height);
      setPreviewImage(original.blob);
      setStatus('Retake photo saved.');
      await bridge.commitRetake(sessionId, slot.slotNumber, pending.photoId);
      await loadReviewSession(sessionId);
      setStatus(`Photo ${slot.slotNumber} replaced · previous version saved`);
      setLastActivity(Date.now());
      await wait(700);
      setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
      await refreshUnfinishedSessions();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Retake failed. Your saved photos are safe.');
      if (sessionId) await loadReviewSession(sessionId).catch(() => undefined);
      await refreshUnfinishedSessions();
    } finally { setRetakeBusySlot(null); }
  };

  const handleRevert = async (slot: SessionSlot): Promise<void> => {
    if (!window.photobooth || !sessionId || !slot.previousPhotoId) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await window.photobooth.revertRetake(sessionId, slot.slotNumber);
      await loadReviewSession(sessionId);
      setStatus(`Previous photo restored in slot ${slot.slotNumber}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not restore the previous photo.');
    } finally { setBusy(false); }
  };

  const handleContinue = async (): Promise<void> => {
    if (!reviewRecord || !sessionId || !window.photobooth || !event) return;
    setBusy(true);
    setErrorMessage('');
    setStatus('Building your 4 × 6 layout…');
    try {
      const blob = await renderFinishedLayout(reviewRecord, event.name);
      const savedPath = await window.photobooth.saveSessionOutput(sessionId, await blobBytes(blob), template.width, template.height);
      setFinalOutputUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
      setStatus(`Finished layout saved · ${savedPath}`);
      setScreen('finished');
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Could not build the finished layout. Your photos are safe.'); }
    finally { setBusy(false); }
  };

  const returnToReady = (): void => {
    setScreen('ready');
    setSessionId('');
    setReviewRecord(null);
    clearReviewUrls();
    setFinalOutputUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    setErrorMessage('');
    setStatus('Camera is ready');
    void refreshUnfinishedSessions();
  };

  const handleDiskWarningChange = (value: string): void => setDiskWarningGB(value);
  const saveDiskWarning = (): void => {
    const threshold = Number(diskWarningGB);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000) { setDiskWarningGB('2'); return; }
    setDiskWarningGB(String(threshold));
    void savePreference('lowDiskWarningGB', String(threshold)).catch(() => setErrorMessage('Could not save the disk warning threshold.'));
  };
  const handleExportEvent = async (): Promise<void> => {
    if (!window.photobooth || !event) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const exportedTo = await window.photobooth.exportEvent(event.id);
      if (exportedTo) setStatus(`Event exported to ${exportedTo}`);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Event export failed. Your photos remain safe.'); }
    finally { setBusy(false); }
  };

  const handleRetakeLimitChange = async (limit: number): Promise<void> => {
    if (!window.photobooth) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const updatedEvent = await window.photobooth.setActiveEventRetakeLimit(limit);
      setEvent(updatedEvent);
      setRetakeLimitDraft(updatedEvent.retakeLimit === -1 ? '' : String(updatedEvent.retakeLimit));
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Could not save the event retake limit.'); }
    finally { setBusy(false); }
  };

  const handleRetakeLimitInput = (value: string): void => setRetakeLimitDraft(value);
  const saveRetakeLimitDraft = (): void => {
    if (retakeLimitDraft === '' || !isValidRetakeLimit(Number(retakeLimitDraft))) {
      setRetakeLimitDraft(event?.retakeLimit === -1 ? '' : String(event?.retakeLimit ?? 3));
      return;
    }
    const value = Number(retakeLimitDraft);
    if (value !== event?.retakeLimit) void handleRetakeLimitChange(value);
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
  const isBusy = busy || screen === 'capturing' || retakeBusySlot !== null;
  const retakeText = reviewRecord ? retakesRemaining(reviewRecord.retakeLimit, reviewRecord.retakesUsed) : 0;

  return (
    <main className="booth-app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PHOTOBOOTH <b>STUDIO</b></span></div>
        <div className="connection"><span className={`connection-dot ${cameraReady ? 'online' : ''}`} />{status}</div>
      </header>
      <section className="workspace">
        <div className="stage-heading">
          <div>
            <p className="eyebrow">{screen === 'ready' ? 'PHOTO SESSION' : screen === 'capturing' ? 'SESSION IN PROGRESS' : screen === 'finished' ? 'FINISHED LAYOUT' : 'REVIEW YOUR PHOTOS'}</p>
            <h1>{screen === 'ready' ? 'Frame the moment.' : screen === 'capturing' ? `Photo ${currentSlot} of ${slotCount}` : screen === 'finished' ? 'Your 4 × 6 layout is ready.' : 'Choose a favorite.'}</h1>
            <p className="subheading">{screen === 'ready' ? `Ready for ${event?.name ?? 'your event'}. Check the preview, then start a session.` : screen === 'capturing' ? 'Stay in frame. Your original photo is saved directly to the session folder.' : screen === 'finished' ? 'The print-size image is saved with this session.' : 'Retake just one slot if needed. Your other photos will stay exactly as they are.'}</p>
          </div>
          <div className="live-badge"><span /> {screen === 'capturing' ? 'CAPTURING' : screen === 'review' ? 'SESSION REVIEW' : screen === 'finished' ? 'LAYOUT READY' : 'LOCAL CAMERA'}</div>
        </div>
        <div className="preview-card">
          <video ref={videoRef} className="camera-video" autoPlay playsInline muted aria-label="Mirrored live camera preview" />
          {!cameraReady && <div className="preview-empty"><div className="camera-glyph">◉</div><strong>{cameras.length ? 'Connecting to your camera…' : 'No camera preview yet'}</strong><span>Connect a webcam or select a camera below.</span></div>}
          {screen === 'finished' && finalOutputUrl && <div className="final-output"><img src={finalOutputUrl} alt="Finished 4 by 6 photo layout" /></div>}
          {photoPreviewUrl && <div className="captured-photo"><img src={photoPreviewUrl} alt={`Saved photo ${currentSlot}`} /><span>PHOTO {currentSlot} SAVED</span></div>}
          {countdown !== null && <div className="countdown-overlay" aria-live="assertive"><span>{countdown}</span></div>}
          <div className="preview-meta"><span>{actualResolution || (cameraReady ? 'Camera ready' : 'Waiting for camera')}</span><span className="mirror-label">MIRRORED</span></div>
        </div>
        <div className="controls-grid">
          <label className="control-field"><span>CAMERA</span><select value={selectedCameraId} onChange={(e) => void handleCameraChange(e.target.value)} disabled={isBusy || screen === 'review' || screen === 'finished' || !cameras.length}><option value="" disabled>Select a camera</option>{cameras.map((item, index) => <option key={item.deviceId || index} value={item.deviceId}>{item.label || `Camera ${index + 1}`}</option>)}</select></label>
          <label className="control-field"><span>PREVIEW QUALITY</span><select value={resolution} onChange={(e) => void handleResolutionChange(e.target.value as CameraResolution)} disabled={isBusy || screen === 'review' || screen === 'finished'}>{resolutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="control-field countdown-setting"><span>COUNTDOWN</span><select value={countdownSeconds} onChange={(e) => void handleCountdownChange(Number(e.target.value))} disabled={isBusy || screen === 'review' || screen === 'finished'}>{Array.from({ length: 8 }, (_, index) => index + 3).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          {screen === 'ready' && <label className="control-field"><span>LOW-DISK WARNING (GB)</span><input aria-label="Low-disk warning threshold in gigabytes" type="number" min="0" max="1000" step="0.1" value={diskWarningGB} onChange={(e) => handleDiskWarningChange(e.target.value)} onBlur={saveDiskWarning} disabled={busy || !window.photobooth} /></label>}
          {screen === 'ready' && <label className="control-field"><span>RETAKES PER SESSION</span><div className="retake-limit-control"><input aria-label="Retakes per session" type="number" min="0" step="1" value={retakeLimitDraft} placeholder="0+" onChange={(e) => handleRetakeLimitInput(e.target.value)} onBlur={saveRetakeLimitDraft} disabled={busy || !window.photobooth || event?.retakeLimit === -1} /><button type="button" className="unlimited-button" onClick={() => void handleRetakeLimitChange(event?.retakeLimit === -1 ? 3 : -1)} disabled={busy || !window.photobooth}>{event?.retakeLimit === -1 ? 'Use a limit' : 'Unlimited'}</button></div></label>}
          {screen === 'review' ? <button className="start-button" type="button" onClick={() => void handleContinue()} disabled={isBusy}>Continue <span aria-hidden="true">→</span></button>
            : screen === 'finished' ? <button className="start-button" type="button" onClick={returnToReady}>Back to start</button>
              : <><button className="secondary-button" type="button" onClick={() => void handleExportEvent()} disabled={busy || !event || !window.photobooth}>Export event</button><button className="start-button" type="button" onClick={() => void handleStartSession()} disabled={!cameraReady || !event || isBusy || unfinishedSessions.length > 0}>Start session <span aria-hidden="true">→</span></button></>}
        </div>
        {screen === 'capturing' && <div className="slot-progress" aria-label="Photo slot progress">{Array.from({ length: slotCount }, (_, index) => index + 1).map((slot) => <div className={`slot-chip ${capturedSlots.has(slot) ? 'saved' : currentSlot === slot ? 'current' : ''}`} key={slot}><b>{String(slot).padStart(2, '0')}</b><span>{capturedSlots.has(slot) ? 'Saved' : currentSlot === slot ? 'Now' : 'Next'}</span></div>)}</div>}
        {screen === 'review' && reviewRecord && <section className="review-section">
          <div className="review-summary"><strong>{retakeText === null ? 'Unlimited retakes' : `${retakeText} retakes left`}</strong><span>{reviewRecord.retakesUsed} used · limit applies across all three slots</span></div>
          <div className="review-grid">{reviewRecord.slots.map((slot) => {
            const image = reviewImages.find((item) => item.slotNumber === slot.slotNumber);
            const allowed = canRetake(reviewRecord.retakeLimit, reviewRecord.retakesUsed);
            return <article className="review-slot" key={slot.slotNumber}>
              <div className="review-image">{image ? <img src={image.url} alt={`Photo ${slot.slotNumber}`} /> : <span>Photo not available</span>}<b>PHOTO {slot.slotNumber}</b></div>
              <div className="review-actions">
                {slot.pendingPhotoId ? <button type="button" onClick={() => void handleRetake(slot)} disabled={isBusy}>Finish saved retake</button>
                  : <button type="button" onClick={() => void handleRetake(slot)} disabled={!allowed || !cameraReady || isBusy}>Retake</button>}
                <button type="button" className="revert-button" onClick={() => void handleRevert(slot)} disabled={!slot.previousPhotoId || isBusy}>Use previous photo</button>
              </div>
            </article>;
          })}</div>
        </section>}
        {unfinishedSessions.length > 0 && screen === 'ready' && <section className="recovery-card"><div><p className="eyebrow">UNFINISHED SESSION</p><strong>{unfinishedSessions[0]!.pendingRetakes ? 'A retake needs finishing' : `${unfinishedSessions[0]!.capturedSlots} of ${unfinishedSessions[0]!.totalSlots} photos saved`}</strong><span>Your photos are safe on this booth. Resume where you left off or discard this session.</span></div><div className="recovery-actions"><button type="button" onClick={() => void handleResumeSession(unfinishedSessions[0]!)} disabled={busy || !cameraReady}>Resume</button><button type="button" className="secondary-button" onClick={() => void handleDiscardSession(unfinishedSessions[0]!)} disabled={busy}>Discard</button></div></section>}
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}<button type="button" onClick={() => void refreshCameras()}>Retry</button></p>}
        {!errorMessage && <p className="helper-note">Originals stay on this booth. No photos are uploaded in this feature.</p>}
      </section>
      <footer className="app-footer"><span>OFFLINE-READY · PRIVATE BY DESIGN</span><span>{event?.name.toUpperCase() ?? 'CAMERA SETUP'}</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
