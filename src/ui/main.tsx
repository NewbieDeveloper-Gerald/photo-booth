import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createRoot } from 'react-dom/client';
import { canRetake, isValidRetakeLimit, retakesRemaining } from '../core/retakes';
import { captureOriginalJpeg } from '../core/photo-pipeline';
import { coverCrop } from '../core/layout';
import { getLayoutPreset, layoutPresets } from '../core/layouts';
import { BrowserCameraDevice, type CameraInfo, type CameraResolution } from '../hardware/camera';
import type { ActiveEvent, EventSettings, SessionRecord, SessionSlot, UnfinishedSession } from '../storage/sessions';
import type { UploadQueueSummary } from '../cloud/upload-queue';
import './style.css';

const resolutionOptions: Array<{ value: CameraResolution; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '3840x2160', label: '4K · 3840 × 2160' },
];
type Screen = 'ready' | 'capturing' | 'review' | 'finished';
type ReviewImage = { slotNumber: number; photoId: string; url: string };

type PreferenceKey = 'selectedCameraId' | 'countdownSeconds' | 'cameraResolution' | 'lowDiskWarningGB' | 'selectedPrinterName' | 'downloadBaseUrl' | 'consentText';
const DEFAULT_CONSENT = 'Your photos are stored locally on this booth until the operator removes them. The private QR download link expires after 30 days. Photos are shared only with people who have the link.';
const DEFAULT_WELCOME = 'Ready for your event. Check the preview, then start a session.';
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

async function renderFinishedLayout(record: SessionRecord, eventName: string, layout: ReturnType<typeof getLayoutPreset>, qrDataUrl?: string, branding?: { primaryColor: string; accentColor: string; thankYouText: string; logoDataUrl: string | null }): Promise<Blob> {
  const bridge = window.photobooth;
  if (!bridge) throw new Error('Finished layouts are available in the desktop app.');
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the finished layout.');
  context.fillStyle = branding?.accentColor ?? layout.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = branding?.primaryColor ?? layout.frameColor;
  context.fillRect(0, 0, canvas.width, 112);
  context.fillStyle = '#ffffff';
  context.font = `700 ${layout.header.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(layout.header.text.replace('{{eventName}}', eventName), qrDataUrl ? (canvas.width - 128) / 2 : canvas.width / 2, 56, canvas.width - (qrDataUrl ? 160 : 80));
  if (branding?.logoDataUrl) {
    const logoBitmap = await createImageBitmap(await (await fetch(branding.logoDataUrl)).blob());
    const scale = Math.min(88 / logoBitmap.width, 88 / logoBitmap.height);
    context.drawImage(logoBitmap, 12, 12, logoBitmap.width * scale, logoBitmap.height * scale);
    logoBitmap.close();
  }
  if (qrDataUrl) {
    const qrBitmap = await createImageBitmap(await (await fetch(qrDataUrl)).blob());
    context.fillStyle = '#ffffff';
    context.fillRect(canvas.width - 112, 8, 104, 104);
    context.drawImage(qrBitmap, canvas.width - 108, 12, 96, 96);
    qrBitmap.close();
  }

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const region of layout.placements) {
      const slot = record.slots.find((item) => item.slotNumber === region.slot);
      if (!slot?.photoId) throw new Error(`Photo ${region.slot} is missing from this session.`);
      const bitmap = await createImageBitmap(bytesBlob(await bridge.readOriginalPhoto(slot.photoId)));
      bitmaps.push(bitmap);
      const crop = coverCrop(bitmap.width, bitmap.height, region.width, region.height);
      context.fillStyle = '#ffffff';
      context.fillRect(region.x - layout.gutter / 2, region.y - layout.gutter / 2, region.width + layout.gutter, region.height + layout.gutter);
      context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, region.x, region.y, region.width, region.height);
    }
  } finally { for (const bitmap of bitmaps) bitmap.close(); }

  context.fillStyle = branding?.primaryColor ?? layout.frameColor;
  context.fillRect(0, canvas.height - 62, canvas.width, 62);
  context.fillStyle = layout.footer.color;
  context.font = `500 ${layout.footer.fontSize}px Inter, Segoe UI, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(branding?.thankYouText ?? layout.footer.text, canvas.width / 2, canvas.height - 31, canvas.width - 60);
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
  const [events, setEvents] = useState<EventSettings[]>([]);
  const [eventDraft, setEventDraft] = useState<EventSettings | null>(null);
  const [eventLogoDataUrl, setEventLogoDataUrl] = useState<string | null>(null);
  const [eventMessage, setEventMessage] = useState('');
  const [retakeLimitDraft, setRetakeLimitDraft] = useState('3');
  const [diskWarningGB, setDiskWarningGB] = useState('2');
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault?: boolean; status?: number }>>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState('');
  const [printStatus, setPrintStatus] = useState('Not printed yet');
  const [downloadBaseUrl, setDownloadBaseUrl] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [screen, setScreen] = useState<Screen>('ready');
  const [sessionId, setSessionId] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState('double-strip-3');
  const [sessionShotCount, setSessionShotCount] = useState(3);
  const [reviewRecord, setReviewRecord] = useState<SessionRecord | null>(null);
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [finalOutputUrl, setFinalOutputUrl] = useState('');
  const [unfinishedSessions, setUnfinishedSessions] = useState<UnfinishedSession[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueSummary | null>(null);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [adminLocked, setAdminLocked] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [currentPinDraft, setCurrentPinDraft] = useState('');
  const [pinError, setPinError] = useState('');
  const [consentText, setConsentText] = useState(DEFAULT_CONSENT);
  const [consentOpen, setConsentOpen] = useState(false);
  const [exitPrompt, setExitPrompt] = useState(false);
  const [exitPin, setExitPin] = useState('');
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

  const refreshUploadQueue = useCallback(async (): Promise<void> => {
    if (!window.photobooth) return;
    try { setUploadQueue(await window.photobooth.getUploadQueue()); }
    catch { setUploadQueue(null); }
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
      const [savedCamera, savedCountdown, savedResolution, savedDiskWarning, savedPrinter, savedDownloadBaseUrl, savedConsentText] = await Promise.all([
        getPreference('selectedCameraId').catch(() => null),
        getPreference('countdownSeconds').catch(() => null),
        getPreference('cameraResolution').catch(() => null),
        getPreference('lowDiskWarningGB').catch(() => null),
        getPreference('selectedPrinterName').catch(() => null),
        getPreference('downloadBaseUrl').catch(() => null),
        getPreference('consentText').catch(() => null),
      ]);
      if (savedDownloadBaseUrl) setDownloadBaseUrl(savedDownloadBaseUrl);
      if (savedConsentText) setConsentText(savedConsentText);
      if (window.photobooth) {
        const configured = await window.photobooth.hasAdminPin().catch(() => false);
        setPinConfigured(configured);
        setAdminLocked(configured);
      }
      if (savedPrinter) setSelectedPrinterName(savedPrinter);
      if (window.photobooth) {
        const availablePrinters = await window.photobooth.listPrinters().catch(() => []);
        if (cancelled) return;
        setPrinters(availablePrinters);
        const preferred = savedPrinter && availablePrinters.some((printer) => printer.name === savedPrinter) ? savedPrinter : availablePrinters.find((printer) => printer.isDefault)?.name ?? availablePrinters[0]?.name ?? '';
        setSelectedPrinterName(preferred);
        if (!savedPrinter && preferred) void savePreference('selectedPrinterName', preferred);
      }
      if (savedDiskWarning !== null && Number.isFinite(Number(savedDiskWarning)) && Number(savedDiskWarning) >= 0 && Number(savedDiskWarning) <= 1000) setDiskWarningGB(savedDiskWarning);
      if (cancelled) return;
      const seconds = Number(savedCountdown);
      if (Number.isInteger(seconds) && seconds >= 3 && seconds <= 10) setCountdownSeconds(seconds);
      if (savedResolution && resolutionOptions.some((item) => item.value === savedResolution)) setResolution(savedResolution as CameraResolution);
      if (window.photobooth) {
        const [activeEvent, savedEvents] = await Promise.all([window.photobooth.getActiveEvent().catch(() => null), window.photobooth.listEvents().catch(() => []), refreshUnfinishedSessions(), refreshUploadQueue()]);
        if (cancelled) return;
        setEvents(savedEvents);
        if (activeEvent) {
          setEvent(activeEvent);
          setEventDraft(activeEvent);
          setSelectedLayoutId(activeEvent.defaultLayoutId);
          setEventLogoDataUrl(await window.photobooth.getEventLogoDataUrl(activeEvent.id).catch(() => null));
          setRetakeLimitDraft(activeEvent.retakeLimit === -1 ? '' : String(activeEvent.retakeLimit));
        }
      } else {
        setEvent({ id: 'preview-event', name: 'Default Event', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30, eventDate: null, logoPath: null, primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: DEFAULT_WELCOME, thankYouText: 'Your layout is ready.', defaultLayoutId: 'double-strip-3' });
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

  useEffect(() => window.photobooth?.onExitRequested(() => { setExitPrompt(true); setExitPin(''); setPinError(''); }), []);

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
    if (pinConfigured) { setAdminLocked(true); setShowUnlock(false); }
    clearReviewUrls();
    setScreen('ready');
    setStatus('Session timed out; saved originals were backed up.');
    setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    await refreshUnfinishedSessions();
  }, [clearReviewUrls, pinConfigured, refreshUnfinishedSessions]);

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
    if (!pinConfigured) { setErrorMessage('Set an admin PIN before starting guest sessions.'); return; }
    if (!cameraReady || !window.photobooth) {
      setErrorMessage(!cameraReady ? 'Connect a camera before starting a session.' : 'Start a session in the desktop app.');
      return;
    }
    setConsentOpen(true);
  };

  const confirmConsentAndStart = async (): Promise<void> => {
    setConsentOpen(false);
    if (!cameraReady || !window.photobooth) return;
    setBusy(true);
    setErrorMessage('');
    setCapturedSlots(new Set());
    clearReviewUrls();
    try {
      if (!await window.photobooth.checkDiskSpace(Number(diskWarningGB))) return;
      const created = await window.photobooth.createSession(selectedLayoutId);
      setEvent(created.event);
      setSessionId(created.sessionId);
      setSessionShotCount(created.shots);
      setScreen('capturing');
      setLastActivity(Date.now());
      await captureSlots(created.sessionId, Array.from({ length: created.shots }, (_, index) => index + 1), created.shots);
    } catch (error) {
      setScreen('ready');
      setErrorMessage(error instanceof Error ? error.message : 'Could not start the session.');
    } finally { setBusy(false); }
  };

  const loadEventBrand = async (active: ActiveEvent): Promise<void> => {
    setEvent(active); setEventDraft(active); setSelectedLayoutId(active.defaultLayoutId);
    setEventLogoDataUrl(await window.photobooth?.getEventLogoDataUrl(active.id).catch(() => null) ?? null);
    setRetakeLimitDraft(active.retakeLimit === -1 ? '' : String(active.retakeLimit));
  };

  const handleSelectEvent = async (eventId: string): Promise<void> => {
    if (!window.photobooth || !eventId) return;
    try { await loadEventBrand(await window.photobooth.selectActiveEvent(eventId)); setEvents(await window.photobooth.listEvents()); setEventMessage('Active event changed.'); }
    catch (error) { setEventMessage(error instanceof Error ? error.message : 'Could not select event.'); }
  };

  const handleNewEvent = (): void => {
    setEventDraft({ id: '', name: '', shots: 3, expiryDays: 30, eventDate: null, logoPath: null, primaryColor: '#c90000', accentColor: '#f4f0ec', welcomeText: DEFAULT_WELCOME, thankYouText: 'Your layout is ready.', defaultLayoutId: 'double-strip-3' });
    setEventLogoDataUrl(null); setEventMessage('New event details are not saved yet.');
  };

  const handleSaveEvent = async (): Promise<void> => {
    if (!window.photobooth || !eventDraft) return;
    try {
      const saved = await window.photobooth.saveEvent(eventDraft);
      const active = await window.photobooth.selectActiveEvent(saved.id);
      await loadEventBrand(active);
      setEvents(await window.photobooth.listEvents());
      setEventMessage('Event saved and selected as active.');
    } catch (error) { setEventMessage(error instanceof Error ? error.message : 'Could not save event.'); }
  };

  const handleDuplicateEvent = async (): Promise<void> => {
    if (!window.photobooth || !event?.id) return;
    try {
      const duplicate = await window.photobooth.duplicateEvent(event.id);
      const active = await window.photobooth.selectActiveEvent(duplicate.id);
      await loadEventBrand(active);
      setEvents(await window.photobooth.listEvents());
      setEventMessage('Event duplicated and selected. Edit the copy, then save.');
    } catch (error) { setEventMessage(error instanceof Error ? error.message : 'Could not duplicate event.'); }
  };

  const handleChooseEventLogo = async (): Promise<void> => {
    if (!window.photobooth || !eventDraft) return;
    try {
      let eventId = eventDraft.id;
      if (!eventId) {
        const saved = await window.photobooth.saveEvent(eventDraft);
        eventId = saved.id;
        const active = await window.photobooth.selectActiveEvent(eventId);
        await loadEventBrand(active);
        setEvents(await window.photobooth.listEvents());
      }
      const logo = await window.photobooth.chooseEventLogo(eventId);
      if (logo) { const active = await window.photobooth.getActiveEvent(); await loadEventBrand(active); setEvents(await window.photobooth.listEvents()); setEventMessage('Logo copied into the booth event assets.'); }
    } catch (error) { setEventMessage(error instanceof Error ? error.message : 'Could not add logo.'); }
  };

  const savePin = async (): Promise<void> => {
    if (!window.photobooth) return;
    if (!/^\d{6,12}$/.test(pinDraft) || pinDraft !== pinConfirm) { setPinError('Enter matching PINs of 6 to 12 digits.'); return; }
    try {
      await window.photobooth.setAdminPin(pinDraft, pinConfigured ? currentPinDraft : '');
      setPinConfigured(true);
      setAdminLocked(false);
      setPinError('Admin PIN saved. Lock the booth before guests use it.');
      setPinDraft(''); setPinConfirm(''); setCurrentPinDraft('');
    } catch (error) { setPinError(error instanceof Error ? error.message : 'Could not save admin PIN.'); }
  };

  const unlockAdmin = async (): Promise<void> => {
    if (!window.photobooth) return;
    const valid = await window.photobooth.verifyAdminPin(currentPinDraft).catch(() => false);
    if (!valid) { setPinError('Incorrect admin PIN.'); return; }
    setAdminLocked(false); setShowUnlock(false); setCurrentPinDraft(''); setPinError('');
  };

  const submitExit = async (): Promise<void> => {
    if (!window.photobooth) return;
    const exited = await window.photobooth.exitKioskWithPin(exitPin).catch(() => false);
    if (!exited) { setPinError('Incorrect admin PIN; the booth remains locked.'); return; }
    setExitPrompt(false);
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
      setSelectedLayoutId(saved.layoutId);
      setSessionShotCount(saved.slots.length);
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

  const handlePrinterChange = (printerName: string): void => {
    setSelectedPrinterName(printerName);
    void savePreference('selectedPrinterName', printerName).catch(() => setErrorMessage('Could not save the printer choice.'));
  };

  const sendPrintJob = async (activeSessionId: string): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !selectedPrinterName) { setPrintStatus('No printer selected. Choose one, then print.'); return; }
    setPrintStatus(`Sending to ${selectedPrinterName}…`);
    try {
      const result = await bridge.printSessionOutput(activeSessionId, selectedPrinterName);
      setPrintStatus(result.success ? `Done · ${selectedPrinterName}` : `Failed · ${result.error ?? 'printer error'}`);
    } catch (error) { setPrintStatus(`Failed · ${error instanceof Error ? error.message : 'printer error'}`); }
  };

  const handleReprint = async (): Promise<void> => {
    if (!sessionId || !selectedPrinterName) { setPrintStatus('Choose a printer before printing.'); return; }
    setBusy(true);
    await sendPrintJob(sessionId);
    setBusy(false);
  };

  const handleContinue = async (): Promise<void> => {
    if (!reviewRecord || !sessionId || !window.photobooth || !event) return;
    setBusy(true);
    setErrorMessage('');
    setStatus('Building your 4 × 6 layout…');
    try {
      const layout = getLayoutPreset(reviewRecord.layoutId);
      let nextShareUrl = '';
      let qrDataUrl = '';
      if (downloadBaseUrl) {
        try {
          const link = await window.photobooth.createShareLink(sessionId);
          nextShareUrl = link.url;
          qrDataUrl = await QRCode.toDataURL(link.url, { width: 256, margin: 1, errorCorrectionLevel: 'Q' });
          setShareStatus(`Link expires ${new Date(link.expiresAt).toLocaleDateString()}`);
        } catch (error) { setShareStatus(error instanceof Error ? error.message : 'QR downloads are not available.'); }
      } else setShareStatus('Set the public HTTPS download URL on the start screen to enable QR downloads.');
      const blob = await renderFinishedLayout(reviewRecord, event.name, layout, qrDataUrl || undefined, { primaryColor: event.primaryColor, accentColor: event.accentColor, thankYouText: event.thankYouText, logoDataUrl: eventLogoDataUrl });
      const savedPath = await window.photobooth.saveSessionOutput(sessionId, await blobBytes(blob), layout.width, layout.height);
      await window.photobooth.enqueueSessionUploads(sessionId);
      await refreshUploadQueue();
      setShareUrl(nextShareUrl);
      setFinalOutputUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
      setStatus(`Finished layout saved · ${savedPath}`);
      setScreen('finished');
      await sendPrintJob(sessionId);
    } catch (error) { setErrorMessage(error instanceof Error ? error.message : 'Could not build the finished layout. Your photos are safe.'); }
    finally { setBusy(false); }
  };

  const returnToReady = (): void => {
    setScreen('ready');
    setSessionId('');
    setReviewRecord(null);
    if (pinConfigured) { setAdminLocked(true); setShowUnlock(false); }
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

  const slotCount = sessionShotCount || event?.shots || 3;
  const isBusy = busy || screen === 'capturing' || retakeBusySlot !== null;
  const retakeText = reviewRecord ? retakesRemaining(reviewRecord.retakeLimit, reviewRecord.retakesUsed) : 0;

  return (
    <main className="booth-app" style={{ '--event-primary': event?.primaryColor ?? '#c90000', '--event-accent': event?.accentColor ?? '#f4f0ec' } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PHOTOBOOTH <b>STUDIO</b></span></div>
        <div className="connection"><span className={`connection-dot ${cameraReady ? 'online' : ''}`} />{status}</div>
      </header>
      <section className="workspace">
        <div className="stage-heading">
          {eventLogoDataUrl && <img className="event-brand-logo" src={eventLogoDataUrl} alt={`${event?.name ?? 'Event'} logo`} />}
          <div>
            <p className="eyebrow">{screen === 'ready' ? 'PHOTO SESSION' : screen === 'capturing' ? 'SESSION IN PROGRESS' : screen === 'finished' ? 'FINISHED LAYOUT' : 'REVIEW YOUR PHOTOS'}</p>
            <h1>{screen === 'ready' ? (event?.welcomeText || 'Frame the moment.') : screen === 'capturing' ? `Photo ${currentSlot} of ${slotCount}` : screen === 'finished' ? (event?.thankYouText || 'Your layout is ready.') : 'Choose a favorite.'}</h1>
            <p className="subheading">{screen === 'ready' ? `Ready for ${event?.name ?? 'your event'}${event?.eventDate ? ` · ${event.eventDate}` : ''}. Check the preview, then start a session.` : screen === 'capturing' ? 'Stay in frame. Your original photo is saved directly to the session folder.' : screen === 'finished' ? 'The selected print-size image is saved with this session.' : 'Retake just one slot if needed. Your other photos will stay exactly as they are.'}</p>
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
        <div className={`controls-grid ${screen === 'ready' && adminLocked ? 'settings-locked' : ''}`}>
          <label className="control-field"><span>CAMERA</span><select value={selectedCameraId} onChange={(e) => void handleCameraChange(e.target.value)} disabled={isBusy || screen === 'review' || screen === 'finished' || !cameras.length}><option value="" disabled>Select a camera</option>{cameras.map((item, index) => <option key={item.deviceId || index} value={item.deviceId}>{item.label || `Camera ${index + 1}`}</option>)}</select></label>
          <label className="control-field"><span>PREVIEW QUALITY</span><select value={resolution} onChange={(e) => void handleResolutionChange(e.target.value as CameraResolution)} disabled={isBusy || screen === 'review' || screen === 'finished'}>{resolutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="control-field countdown-setting"><span>COUNTDOWN</span><select value={countdownSeconds} onChange={(e) => void handleCountdownChange(Number(e.target.value))} disabled={isBusy || screen === 'review' || screen === 'finished'}>{Array.from({ length: 8 }, (_, index) => index + 3).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          {screen === 'ready' && <label className="control-field layout-choice"><span>PRINT LAYOUT</span><select aria-label="Print layout" value={selectedLayoutId} onChange={(e) => setSelectedLayoutId(e.target.value)} disabled={busy || unfinishedSessions.length > 0}>{layoutPresets.filter((item) => item.shots === (event?.shots ?? 3)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.shots} shots · {item.copies} {item.copies === 1 ? 'copy' : 'copies'} · {item.width}×{item.height}</option>)}</select></label>}
          {(screen === 'ready' || screen === 'finished') && <label className="control-field"><span>PRINTER</span><select aria-label="Printer" value={selectedPrinterName} onChange={(e) => handlePrinterChange(e.target.value)} disabled={busy || !window.photobooth}><option value="">Select a printer</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ' · Default' : ''}</option>)}</select></label>}
          {screen === 'ready' && <label className="control-field"><span>PUBLIC DOWNLOAD URL (HTTPS)</span><input aria-label="Public HTTPS download URL" type="url" placeholder="https://photos.example.com" value={downloadBaseUrl} onChange={(e) => setDownloadBaseUrl(e.target.value)} onBlur={() => void savePreference('downloadBaseUrl', downloadBaseUrl.trim().replace(/\/$/, '')).catch(() => setErrorMessage('Enter a valid HTTPS site URL.'))} disabled={busy || !window.photobooth} /></label>}
          {screen === 'ready' && <label className="control-field"><span>LOW-DISK WARNING (GB)</span><input aria-label="Low-disk warning threshold in gigabytes" type="number" min="0" max="1000" step="0.1" value={diskWarningGB} onChange={(e) => handleDiskWarningChange(e.target.value)} onBlur={saveDiskWarning} disabled={busy || !window.photobooth} /></label>}
          {screen === 'ready' && <label className="control-field"><span>RETAKES PER SESSION</span><div className="retake-limit-control"><input aria-label="Retakes per session" type="number" min="0" step="1" value={retakeLimitDraft} placeholder="0+" onChange={(e) => handleRetakeLimitInput(e.target.value)} onBlur={saveRetakeLimitDraft} disabled={busy || !window.photobooth || event?.retakeLimit === -1} /><button type="button" className="unlimited-button" onClick={() => void handleRetakeLimitChange(event?.retakeLimit === -1 ? 3 : -1)} disabled={busy || !window.photobooth}>{event?.retakeLimit === -1 ? 'Use a limit' : 'Unlimited'}</button></div></label>}
          {screen === 'review' ? <button className="start-button" type="button" onClick={() => void handleContinue()} disabled={isBusy}>Continue <span aria-hidden="true">→</span></button>
            : screen === 'finished' ? <><button className="secondary-button" type="button" onClick={() => void handleReprint()} disabled={busy || !selectedPrinterName}>Reprint</button><button className="start-button" type="button" onClick={returnToReady} disabled={busy}>Back to start</button></>
              : <><button className="secondary-button" type="button" onClick={() => void handleExportEvent()} disabled={busy || !event || !window.photobooth}>Export event</button><button className="start-button" type="button" onClick={() => void handleStartSession()} disabled={!cameraReady || !event || !pinConfigured || isBusy || unfinishedSessions.length > 0}>Start session <span aria-hidden="true">→</span></button></>}
        </div>
        {screen === 'ready' && !adminLocked && <section className="event-manager-card" aria-label="Event setup and branding">
          <div className="event-manager-heading"><div><p className="eyebrow">EVENT SETUP</p><h2>Event details & branding</h2></div><div className="event-manager-actions"><select aria-label="Active event" disabled={unfinishedSessions.length > 0} value={event?.id ?? ''} onChange={(e) => void handleSelectEvent(e.target.value)}>{events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="secondary-button" onClick={handleNewEvent} disabled={unfinishedSessions.length > 0}>New event</button><button type="button" className="secondary-button" onClick={() => void handleDuplicateEvent()} disabled={!event || unfinishedSessions.length > 0}>Duplicate active</button></div></div>
          {eventDraft && <div className="event-form-grid">
            <label>Event name<input aria-label="Event name" maxLength={80} value={eventDraft.name} onChange={(e) => setEventDraft({ ...eventDraft, name: e.target.value })} /></label>
            <label>Event date<input aria-label="Event date" type="date" value={eventDraft.eventDate ?? ''} onChange={(e) => setEventDraft({ ...eventDraft, eventDate: e.target.value || null })} /></label>
            <label>Photo count<select aria-label="Event photo count" value={eventDraft.shots} onChange={(e) => setEventDraft({ ...eventDraft, shots: Number(e.target.value) })}><option value={2}>2 photos</option><option value={3}>3 photos</option><option value={4}>4 photos</option></select></label>
            <label>QR link expires after (days)<input aria-label="QR link expiry days" type="number" min={1} max={365} value={eventDraft.expiryDays} onChange={(e) => setEventDraft({ ...eventDraft, expiryDays: Number(e.target.value) })} /></label>
            <label>Primary color (hex)<input aria-label="Primary color hex" value={eventDraft.primaryColor} maxLength={7} onChange={(e) => setEventDraft({ ...eventDraft, primaryColor: e.target.value })} /></label>
            <label>Accent color (hex)<input aria-label="Accent color hex" value={eventDraft.accentColor} maxLength={7} onChange={(e) => setEventDraft({ ...eventDraft, accentColor: e.target.value })} /></label>
            <label>Welcome text<input aria-label="Event welcome text" maxLength={160} value={eventDraft.welcomeText} onChange={(e) => setEventDraft({ ...eventDraft, welcomeText: e.target.value })} /></label>
            <label>Thank-you text<input aria-label="Event thank-you text" maxLength={160} value={eventDraft.thankYouText} onChange={(e) => setEventDraft({ ...eventDraft, thankYouText: e.target.value })} /></label>
            <div className="event-logo-field">{eventLogoDataUrl ? <img src={eventLogoDataUrl} alt="Selected event logo preview" /> : <span>No logo selected</span>}<button type="button" className="secondary-button" onClick={() => void handleChooseEventLogo()} disabled={unfinishedSessions.length > 0}>Choose PNG/JPEG logo</button><small>Files are copied locally; limit 5 MB.</small></div>
            <button type="button" className="start-button" onClick={() => void handleSaveEvent()} disabled={unfinishedSessions.length > 0}>Save and use this event</button>
          </div>}
          {eventMessage && <p className="event-message" role="status">{eventMessage}</p>}
        </section>}
        {screen === 'ready' && <section className="admin-security-card" aria-label="Operator security">
          {!pinConfigured ? <><p className="eyebrow">FIRST-TIME SETUP</p><h2>Create admin PIN</h2><p>Set a PIN before starting guest sessions. Use 6 to 12 digits and keep it private.</p><label>New PIN<input aria-label="New admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>Confirm PIN<input aria-label="Confirm admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} /></label><button type="button" onClick={() => void savePin()}>Save admin PIN</button></>
            : adminLocked ? <><p className="eyebrow">GUEST MODE</p><h2>Booth locked</h2><p>Operator settings are hidden. Enter the admin PIN to unlock them.</p>{showUnlock ? <><label>Admin PIN<input aria-label="Admin PIN to unlock settings" type="password" inputMode="numeric" maxLength={12} autoComplete="current-password" value={currentPinDraft} onChange={(e) => setCurrentPinDraft(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void unlockAdmin(); }} /></label><button type="button" onClick={() => void unlockAdmin()}>Unlock settings</button><button type="button" className="secondary-button" onClick={() => { setShowUnlock(false); setCurrentPinDraft(''); setPinError(''); }}>Cancel</button></> : <button type="button" onClick={() => { setShowUnlock(true); setPinError(''); }}>Operator unlock</button>}</>
              : <><p className="eyebrow">OPERATOR SETTINGS</p><h2>Admin access</h2><label>Current PIN<input aria-label="Current admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="current-password" value={currentPinDraft} onChange={(e) => setCurrentPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>New PIN<input aria-label="Replacement admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>Confirm new PIN<input aria-label="Confirm replacement PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} /></label><button type="button" onClick={() => void savePin()}>Change admin PIN</button><label>Consent notice shown before every session<textarea aria-label="Consent notice wording" maxLength={1200} value={consentText} onChange={(e) => setConsentText(e.target.value)} onBlur={() => void savePreference('consentText', consentText).catch((error: unknown) => setPinError(error instanceof Error ? error.message : 'Could not save consent text.'))} /></label><p className="consent-retention-note">Current default explains local retention and 30-day QR-link expiry; it does not claim automatic photo deletion.</p><button type="button" onClick={() => { setAdminLocked(true); setShowUnlock(false); setPinError(''); setPinDraft(''); setPinConfirm(''); setCurrentPinDraft(''); }}>Lock guest mode</button><button type="button" className="secondary-button" onClick={() => { setExitPrompt(true); setExitPin(''); setPinError(''); }}>Exit booth…</button></>}
          {pinError && <p className="pin-error" role="alert">{pinError}</p>}
        </section>}
        {consentOpen && <div className="modal-backdrop"><section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-heading"><p className="eyebrow">BEFORE WE TAKE A PHOTO</p><h2 id="consent-heading">Please read and agree</h2><p className="consent-copy">{consentText}</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setConsentOpen(false)}>Not now</button><button type="button" className="start-button" onClick={() => void confirmConsentAndStart()}>Agree and continue</button></div></section></div>}
        {exitPrompt && <div className="modal-backdrop"><section className="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-heading"><p className="eyebrow">ADMIN AUTHORIZATION</p><h2 id="exit-heading">Exit booth?</h2><p>Enter the admin PIN to close the photobooth application.</p><label>Admin PIN<input aria-label="Admin PIN to exit booth" type="password" inputMode="numeric" maxLength={12} autoComplete="current-password" value={exitPin} onChange={(e) => setExitPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void submitExit(); }} /></label><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => { setExitPrompt(false); setExitPin(''); setPinError(''); }}>Cancel</button><button type="button" onClick={() => void submitExit()}>Verify and exit</button></div>{pinError && <p className="pin-error" role="alert">{pinError}</p>}</section></div>}
        {screen === 'finished' && <p className="share-status" role="status">{shareUrl ? <>Scan to download: <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a> · {shareStatus}</> : shareStatus}</p>}
        {screen === 'finished' && <p className={`print-status ${printStatus.startsWith('Failed') ? 'failed' : printStatus.startsWith('Done') ? 'done' : ''}`} role="status">{printStatus}</p>}
        {screen === 'capturing' && <div className="slot-progress" aria-label="Photo slot progress">{Array.from({ length: slotCount }, (_, index) => index + 1).map((slot) => <div className={`slot-chip ${capturedSlots.has(slot) ? 'saved' : currentSlot === slot ? 'current' : ''}`} key={slot}><b>{String(slot).padStart(2, '0')}</b><span>{capturedSlots.has(slot) ? 'Saved' : currentSlot === slot ? 'Now' : 'Next'}</span></div>)}</div>}
        {screen === 'review' && reviewRecord && <section className="review-section">
          <div className="review-summary"><strong>{retakeText === null ? 'Unlimited retakes' : `${retakeText} retakes left`}</strong><span>{reviewRecord.retakesUsed} used · limit applies across all session photos</span></div>
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
        {unfinishedSessions.length > 0 && screen === 'ready' && !adminLocked && <section className="recovery-card"><div><p className="eyebrow">UNFINISHED SESSION</p><strong>{unfinishedSessions[0]!.pendingRetakes ? 'A retake needs finishing' : `${unfinishedSessions[0]!.capturedSlots} of ${unfinishedSessions[0]!.totalSlots} photos saved`}</strong><span>Your photos are safe on this booth. Resume where you left off or discard this session.</span></div><div className="recovery-actions"><button type="button" onClick={() => void handleResumeSession(unfinishedSessions[0]!)} disabled={busy || !cameraReady}>Resume</button><button type="button" className="secondary-button" onClick={() => void handleDiscardSession(unfinishedSessions[0]!)} disabled={busy}>Discard</button></div></section>}
        {screen === 'ready' && uploadQueue && <section className="recovery-card upload-queue-card" aria-label="Upload queue status"><div><p className="eyebrow">UPLOAD QUEUE · MOCK-ONLY</p><strong>{uploadQueue.pending + uploadQueue.uploading} waiting · {uploadQueue.uploaded} completed</strong><span>No cloud uploader is configured, so files remain on this booth and nothing is sent online. Queue items will wait until a provider is added.</span>{uploadQueue.lastError && <span>Last error: {uploadQueue.lastError}</span>}</div><span className="queue-failed">{uploadQueue.failed} failed</span></section>}
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}<button type="button" onClick={() => void refreshCameras()}>Retry</button></p>}
        {!errorMessage && <p className="helper-note">Originals stay on this booth. No photos are uploaded in this feature.</p>}
      </section>
      <footer className="app-footer"><span>OFFLINE-READY · PRIVATE BY DESIGN</span><span>{event?.name.toUpperCase() ?? 'CAMERA SETUP'}</span></footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
