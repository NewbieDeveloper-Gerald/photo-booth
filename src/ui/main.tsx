import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createRoot } from 'react-dom/client';
import { BrowserCameraDevice, canRetake, captureOriginalJpeg, isValidRetakeLimit, type CameraInfo, type CameraResolution, type WatermarkPosition } from '../features/capture';
import { cameraErrorMessage } from '../features/capture/domain/camera-messages';
import { blobToBytes, bytesToJpegBlob } from '../shared/dom/blob';
import { saveGuestDownloadCopy, type GuestCopyWatermark } from '../renderer/lib/guest-download-copy';
import { loadImageElement } from '../renderer/lib/load-image';
import { useIdleTimeout } from '../renderer/hooks/useIdleTimeout';
import { readPreference, savePreference } from '../renderer/lib/preferences';
import { ConsentDialog } from '../renderer/components/ConsentDialog';
import { ExitDialog } from '../renderer/components/ExitDialog';
import { RecoveryCard } from '../renderer/components/RecoveryCard';
import { ReviewSection } from '../renderer/components/ReviewSection';
import { SlotProgress } from '../renderer/components/SlotProgress';
import { TemplateEditor } from '../renderer/components/TemplateEditor';
import { UploadQueueCard } from '../renderer/components/UploadQueueCard';
import { ConfirmAction } from '../renderer/components/ConfirmAction';
import { RetentionNote } from '../renderer/components/RetentionNote';
import { GuestLayoutField } from '../renderer/components/GuestLayoutField';
import { PrintQueueCard } from '../renderer/components/PrintQueueCard';
import { AttractScreen } from '../renderer/components/AttractScreen';
import { AttractMediaField } from '../renderer/components/AttractMediaField';
import { loadAttractSlides, type AttractSlide } from '../renderer/lib/attract-slides';
import { composeStripCutSheet } from '../renderer/lib/print-sheet';
import { LayoutPicker } from '../renderer/components/LayoutPicker';
import { boothLayoutChoices } from '../renderer/lib/offered-layouts';
import { defaultLayoutIdForShots } from '../features/events';
import { wait } from '../renderer/lib/timing';
import { DEFAULT_ACCENT_COLOR, DEFAULT_CONSENT_TEXT, DEFAULT_PRIMARY_COLOR, DEFAULT_THANK_YOU_TEXT, DEFAULT_WELCOME_TEXT } from '../shared/constants/branding-defaults';
import { toErrorMessage } from '../shared/errors';
import {
  CAPTURE_REVIEW_PAUSE_MS, MAX_ATTRACT_IDLE_SECONDS, MAX_DISK_WARNING_GB, MAX_EVENT_PAPER_COUNT, MAX_PRINT_LIMIT_PER_SESSION,
  MAX_WATERMARK_OPACITY, MAX_WATERMARK_SCALE_PERCENT, MIN_ATTRACT_IDLE_SECONDS, MIN_PRINT_LIMIT_PER_SESSION,
  MIN_WATERMARK_OPACITY, MIN_WATERMARK_SCALE_PERCENT, PRINT_QUEUE_POLL_MS, SESSION_IDLE_TIMEOUT_MS, UPLOAD_STATUS_POLL_MS,
} from '../shared/constants/limits';
import { renderTemplateLayout, templateFromCatalogPreset, getLayoutPreset, layoutPresets, type TemplateDocument, type TemplateSummary } from '../features/layouts';
import { decideAutoPrint, type PrintJob, type PrintQueueSummary } from '../features/printing';
import type { ActiveEvent, EventSettings } from '../shared/types/event';
import type { SessionRecord, SessionSlot, UnfinishedSession } from '../shared/types/session';
import type { UploadQueueSummary } from '../features/sharing';
import type { RetentionStatus } from '../features/retention';
import type { AttractMedia } from '../shared/types/attract';
import './style.css';

const resolutionOptions: Array<{ value: CameraResolution; label: string }> = [
  { value: 'best', label: 'Best available' },
  { value: '1280x720', label: 'HD · 1280 × 720' },
  { value: '1920x1080', label: 'Full HD · 1920 × 1080' },
  { value: '3840x2160', label: '4K · 3840 × 2160' },
];
type Screen = 'ready' | 'capturing' | 'review' | 'finished';
type ReviewImage = { slotNumber: number; photoId: string; url: string };

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
  /** The job the finished screen is following, so its progress is visible to the operator. */
  const [printJobId, setPrintJobId] = useState('');
  const [printJobs, setPrintJobs] = useState<PrintJob[]>([]);
  const [printSummary, setPrintSummary] = useState<PrintQueueSummary | null>(null);
  /** F19: the idle loop that invites guests in, and the media it cycles through. */
  const [attractVisible, setAttractVisible] = useState(false);
  const [attractMedia, setAttractMedia] = useState<AttractMedia[]>([]);
  const [attractSlides, setAttractSlides] = useState<AttractSlide[]>([]);
  const [downloadBaseUrl, setDownloadBaseUrl] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [screen, setScreen] = useState<Screen>('ready');
  const [sessionId, setSessionId] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState('double-strip-3');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  /** Documents for the offered layouts, fetched once per event so the picker can draw them. */
  const [layoutDocuments, setLayoutDocuments] = useState<Record<string, TemplateDocument>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [sessionShotCount, setSessionShotCount] = useState(3);
  const [reviewRecord, setReviewRecord] = useState<SessionRecord | null>(null);
  const [reviewImages, setReviewImages] = useState<ReviewImage[]>([]);
  const [finalOutputUrl, setFinalOutputUrl] = useState('');
  const [unfinishedSessions, setUnfinishedSessions] = useState<UnfinishedSession[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueSummary | null>(null);
  const [queueWarning, setQueueWarning] = useState('');
  const [retention, setRetention] = useState<RetentionStatus | null>(null);
  const [galleryPasswordDraft, setGalleryPasswordDraft] = useState('');
  const [galleryLink, setGalleryLink] = useState('');
  const [pinConfigured, setPinConfigured] = useState(false);
  const [adminLocked, setAdminLocked] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [currentPinDraft, setCurrentPinDraft] = useState('');
  const [pinError, setPinError] = useState('');
  const [consentText, setConsentText] = useState(DEFAULT_CONSENT_TEXT);
  const [consentOpen, setConsentOpen] = useState(false);
  const [exitPrompt, setExitPrompt] = useState(false);
  const [exitPin, setExitPin] = useState('');
  const [capturedSlots, setCapturedSlots] = useState<Set<number>>(new Set());
  const [currentSlot, setCurrentSlot] = useState(0);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [retakeBusySlot, setRetakeBusySlot] = useState<number | null>(null);

  /** The stored template, or the built-in equivalent when running in the browser preview. */
  const loadLayoutDocument = useCallback(async (templateId: string): Promise<TemplateDocument> => {
    if (window.photobooth) return window.photobooth.getTemplate(templateId);
    return templateFromCatalogPreset(getLayoutPreset(templateId));
  }, []);

  const layoutChoices = useMemo(() => event ? boothLayoutChoices(event, templates) : [], [event, templates]);

  useEffect(() => {
    let cancelled = false;
    const offered = layoutChoices.filter((choice) => !layoutDocuments[choice.id]);
    if (offered.length === 0) return;
    void Promise.all(offered.map(async (choice) => ({ id: choice.id, document: await loadLayoutDocument(choice.id).catch(() => null) })))
      .then((loaded) => {
        if (cancelled) return;
        const usable = loaded.filter((item): item is { id: string; document: TemplateDocument } => item.document !== null);
        if (usable.length > 0) setLayoutDocuments((current) => ({ ...current, ...Object.fromEntries(usable.map((item) => [item.id, item.document])) }));
      });
    return () => { cancelled = true; };
    // `layoutDocuments` is read as a cache guard; adding it would loop on every fetch.
  }, [layoutChoices, loadLayoutDocument]);

  /** The picker's choice must always be a layout the active event actually offers. */
  useEffect(() => {
    const first = layoutChoices[0];
    if (!first || layoutChoices.some((choice) => choice.id === selectedLayoutId)) return;
    setSelectedLayoutId(first.id);
  }, [layoutChoices, selectedLayoutId]);

  /** The event logo decoded once, so watermarking a sequence does not re-decode it per shot. */
  const watermarkLogo = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    watermarkLogo.current = null;
    if (!eventLogoDataUrl) return;
    let cancelled = false;
    void loadImageElement(eventLogoDataUrl)
      .then((image) => { if (!cancelled) watermarkLogo.current = image; })
      .catch(() => { watermarkLogo.current = null; });
    return () => { cancelled = true; };
  }, [eventLogoDataUrl]);

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

  const refreshPrintQueue = useCallback(async (eventId?: string): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge) return;
    try {
      const [summary, jobs] = await Promise.all([bridge.getPrintQueueSummary(eventId), bridge.listPrintJobs(eventId)]);
      setPrintSummary(summary);
      setPrintJobs(jobs);
    } catch { setPrintSummary(null); }
  }, []);

  /** Printing runs in the main process, so the panel polls rather than listening to events. */
  useEffect(() => {
    if (!window.photobooth || (screen !== 'ready' && screen !== 'finished')) return;
    const activeEventId = event?.id;
    void refreshPrintQueue(activeEventId);
    const timer = setInterval(() => void refreshPrintQueue(activeEventId), PRINT_QUEUE_POLL_MS);
    return () => clearInterval(timer);
  }, [screen, event?.id, refreshPrintQueue]);

  /** Follows the queued job so the operator sees it leave the queue and reach the printer. */
  useEffect(() => {
    if (!printJobId) return;
    const job = printJobs.find((item) => item.id === printJobId);
    if (!job) return;
    if (job.status === 'queued') setPrintStatus(`Queued · ${job.printerName}`);
    else if (job.status === 'printing') setPrintStatus(`Printing · ${job.printerName}`);
    else if (job.status === 'done') setPrintStatus(`Done · ${job.printerName}`);
    else if (job.status === 'failed') setPrintStatus(`Failed · ${job.error ?? 'printer error'}`);
    else setPrintStatus('Print cancelled.');
  }, [printJobId, printJobs]);

  /**
   * Attract media is read once per event: the files are copied into the event's own folder, and
   * the slides keep blob URLs so the loop does not re-read a clip every time it comes round.
   */
  const releaseSlides = useRef<(() => void) | null>(null);
  const refreshAttractMedia = useCallback(async (eventId?: string): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !eventId) { setAttractMedia([]); setAttractSlides([]); return; }
    const listed = await bridge.listAttractMedia(eventId).catch(() => [] as AttractMedia[]);
    setAttractMedia(listed);
    const loaded = await loadAttractSlides(bridge, eventId, listed).catch(() => null);
    releaseSlides.current?.();
    releaseSlides.current = loaded?.release ?? null;
    setAttractSlides(loaded?.slides ?? []);
  }, []);

  useEffect(() => {
    void refreshAttractMedia(event?.id);
    return () => { releaseSlides.current?.(); releaseSlides.current = null; };
  }, [event?.id, refreshAttractMedia]);

  useEffect(() => {
    if (!window.photobooth || screen !== 'ready') return;
    const refreshBackgroundStatus = async (): Promise<void> => {
      await Promise.all([refreshUploadQueue(), window.photobooth?.getRetentionStatus().then(setRetention).catch(() => setRetention(null))]);
    };
    void refreshBackgroundStatus();
    const timer = setInterval(() => void refreshBackgroundStatus(), UPLOAD_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [screen, refreshUploadQueue]);

  const loadReviewSession = useCallback(async (activeSessionId: string): Promise<SessionRecord> => {
    const bridge = window.photobooth;
    if (!bridge) throw new Error('Session review is available in the desktop app.');
    const record = await bridge.loadSession(activeSessionId);
    const createdUrls: ReviewImage[] = [];
    try {
      for (const slot of record.slots) {
        if (!slot.photoId) continue;
        const bytes = await bridge.readOriginalPhoto(slot.photoId);
        createdUrls.push({ slotNumber: slot.slotNumber, photoId: slot.photoId, url: URL.createObjectURL(bytesToJpegBlob(bytes)) });
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
        readPreference('selectedCameraId').catch(() => null),
        readPreference('countdownSeconds').catch(() => null),
        readPreference('cameraResolution').catch(() => null),
        readPreference('lowDiskWarningGB').catch(() => null),
        readPreference('selectedPrinterName').catch(() => null),
        readPreference('downloadBaseUrl').catch(() => null),
        readPreference('consentText').catch(() => null),
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
        const [activeEvent, savedEvents, availableTemplates] = await Promise.all([
          window.photobooth.getActiveEvent().catch(() => null),
          window.photobooth.listEvents().catch(() => []),
          window.photobooth.listTemplates().catch(() => []),
        ]);
        if (cancelled) return;
        setEvents(savedEvents);
        setTemplates(availableTemplates);
        if (activeEvent) {
          setEvent(activeEvent);
          setEventDraft(activeEvent);
          setSelectedLayoutId(availableTemplates.some((item) => item.id === activeEvent.defaultLayoutId) ? activeEvent.defaultLayoutId : availableTemplates.find((item) => item.shots === activeEvent.shots)?.id ?? activeEvent.defaultLayoutId);
          setEventLogoDataUrl(await window.photobooth.getEventLogoDataUrl(activeEvent.id).catch(() => null));
          setRetakeLimitDraft(activeEvent.retakeLimit === -1 ? '' : String(activeEvent.retakeLimit));
        }
      } else {
        setTemplates(layoutPresets.map((preset) => ({ id: preset.id, name: preset.name, shots: preset.shots, copies: preset.copies, pagePreset: '4x6' as const, pageLabel: '4 × 6 in', builtIn: true })));
        // The browser preview has no event storage, so it offers three catalog layouts and
        // makes the guest picker visible while developing the UI.
        setEvent({ id: 'preview-event', name: 'Default Event', shots: 3, retakeLimit: 3, printEnabled: true, expiryDays: 30, eventDate: null, logoPath: null, primaryColor: DEFAULT_PRIMARY_COLOR, accentColor: DEFAULT_ACCENT_COLOR, welcomeText: DEFAULT_WELCOME_TEXT, thankYouText: DEFAULT_THANK_YOU_TEXT, defaultLayoutId: 'double-strip-3', offeredLayoutIds: ['double-strip-3', 'double-strip-4', 'grid-4-portrait'], consentText: '', contactText: '', galleryToken: null, galleryPasswordSet: false, watermarkEnabled: false, watermarkPosition: 'bottom-right', watermarkScalePercent: 18, watermarkOpacity: 0.6, printLimitPerSession: 2, paperCount: 0, attractEnabled: true, attractIdleSeconds: 60 });
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

  const { resetActivity } = useIdleTimeout({
    timeoutMs: SESSION_IDLE_TIMEOUT_MS,
    enabled: (screen === 'capturing' || screen === 'review') && Boolean(sessionId) && retakeBusySlot === null,
    onIdle: () => { void abandonForIdle(sessionId); },
  });

  /**
   * The booth goes back to inviting guests in after a few idle minutes (F19). It stays out of
   * the way while the operator is working: an open session, an unlocked settings panel, the
   * layout editor or a dialog all mean someone is doing something.
   */
  const attractAllowed = screen === 'ready' && Boolean(event?.attractEnabled) && !attractVisible
    && !adminLocked && unfinishedSessions.length === 0 && !editorOpen && !consentOpen && !exitPrompt;
  useIdleTimeout({
    timeoutMs: (event?.attractIdleSeconds ?? 60) * 1000,
    enabled: attractAllowed,
    onIdle: () => setAttractVisible(true),
  });

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

  /** Watermarks guest copies only; the original written just before this stays untouched (F17). */
  const guestCopyWatermark = (): GuestCopyWatermark | undefined => {
    const logo = watermarkLogo.current;
    if (!logo || !event?.watermarkEnabled) return undefined;
    return { logo, logoWidth: logo.naturalWidth, logoHeight: logo.naturalHeight, settings: { position: event.watermarkPosition, scalePercent: event.watermarkScalePercent, opacity: event.watermarkOpacity } };
  };

  const saveCapturedSlot = async (activeSessionId: string, slotNumber: number): Promise<void> => {
    const bridge = window.photobooth;
    const video = videoRef.current;
    if (!bridge || !video || !currentStream.current) throw new Error('The camera is not ready for capture.');
    const original = await captureOriginalJpeg(video);
    const saved = await bridge.saveOriginalPhoto(activeSessionId, slotNumber, await blobToBytes(original.blob), original.width, original.height);
    setCapturedSlots((current) => new Set(current).add(slotNumber));
    setPreviewImage(original.blob);
    setStatus(`Photo ${slotNumber} saved.`);
    await saveGuestDownloadCopy(bridge, saved.photoId, original.blob, guestCopyWatermark());
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
        await wait(CAPTURE_REVIEW_PAUSE_MS);
        if (sequenceCancelled.current) return;
        setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
      } catch (error) {
        sequenceCancelled.current = true;
        setCountdown(null);
        setScreen('ready');
        setStatus('Session paused · saved photos are safe');
        setErrorMessage(toErrorMessage(error, 'Capture failed. Resume this session to continue.'));
        setSessionId('');
        await refreshUnfinishedSessions();
        return;
      }
    }
    setCurrentSlot(0);
    setStatus('Review your photos');
    setScreen('review');
    resetActivity();
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
      resetActivity();
      await captureSlots(created.sessionId, Array.from({ length: created.shots }, (_, index) => index + 1), created.shots);
    } catch (error) {
      setScreen('ready');
      setErrorMessage(toErrorMessage(error, 'Could not start the session.'));
    } finally { setBusy(false); }
  };

  const loadEventBrand = async (active: ActiveEvent): Promise<void> => {
    setEvent(active); setEventDraft(active); setSelectedLayoutId(active.defaultLayoutId);
    setGalleryPasswordDraft(''); setGalleryLink('');
    setEventLogoDataUrl(await window.photobooth?.getEventLogoDataUrl(active.id).catch(() => null) ?? null);
    setRetakeLimitDraft(active.retakeLimit === -1 ? '' : String(active.retakeLimit));
  };

  const handleSelectEvent = async (eventId: string): Promise<void> => {
    if (!window.photobooth || !eventId) return;
    try { await loadEventBrand(await window.photobooth.selectActiveEvent(eventId)); setEvents(await window.photobooth.listEvents()); setEventMessage('Active event changed.'); }
    catch (error) { setEventMessage(toErrorMessage(error, 'Could not select event.')); }
  };

  const handleNewEvent = (): void => {
    setEventDraft({ id: '', name: '', shots: 3, expiryDays: 30, eventDate: null, logoPath: null, primaryColor: DEFAULT_PRIMARY_COLOR, accentColor: DEFAULT_ACCENT_COLOR, welcomeText: DEFAULT_WELCOME_TEXT, thankYouText: DEFAULT_THANK_YOU_TEXT, defaultLayoutId: defaultLayoutIdForShots(3), offeredLayoutIds: [defaultLayoutIdForShots(3)], consentText: '', contactText: '', galleryToken: null, galleryPasswordSet: false, watermarkEnabled: false, watermarkPosition: 'bottom-right', watermarkScalePercent: 18, watermarkOpacity: 0.6, printLimitPerSession: 2, paperCount: 0, attractEnabled: true, attractIdleSeconds: 60 });
    setEventLogoDataUrl(null); setEventMessage('New event details are not saved yet.');
  };

  const handleSaveEvent = async (): Promise<void> => {
    if (!window.photobooth || !eventDraft) return;
    try {
      const saved = await window.photobooth.saveEvent(galleryPasswordDraft ? { ...eventDraft, galleryPassword: galleryPasswordDraft } : eventDraft);
      const active = await window.photobooth.selectActiveEvent(saved.id);
      await loadEventBrand(active);
      setEvents(await window.photobooth.listEvents());
      setGalleryPasswordDraft('');
      setEventMessage(galleryPasswordDraft ? 'Event saved, selected as active, and the gallery password updated.' : 'Event saved and selected as active.');
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not save event.')); }
  };

  const handleDuplicateEvent = async (): Promise<void> => {
    if (!window.photobooth || !event?.id) return;
    try {
      const duplicate = await window.photobooth.duplicateEvent(event.id);
      const active = await window.photobooth.selectActiveEvent(duplicate.id);
      await loadEventBrand(active);
      setEvents(await window.photobooth.listEvents());
      setEventMessage('Event duplicated and selected. Edit the copy, then save.');
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not duplicate event.')); }
  };

  const handleChooseEventLogo = async (): Promise<void> => {
    if (!window.photobooth || !eventDraft) return;
    try {
      let eventId = eventDraft.id;
      if (!eventId) {
        const saved = await window.photobooth.saveEvent(galleryPasswordDraft ? { ...eventDraft, galleryPassword: galleryPasswordDraft } : eventDraft);
        eventId = saved.id;
        const active = await window.photobooth.selectActiveEvent(eventId);
        await loadEventBrand(active);
        setEvents(await window.photobooth.listEvents());
      }
      const logo = await window.photobooth.chooseEventLogo(eventId);
      if (logo) { const active = await window.photobooth.getActiveEvent(); await loadEventBrand(active); setEvents(await window.photobooth.listEvents()); setEventMessage('Logo copied into the booth event assets.'); }
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not add logo.')); }
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
    } catch (error) { setPinError(toErrorMessage(error, 'Could not save admin PIN.')); }
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
      resetActivity();
      if (saved.status === 'completed') {
        setScreen('review');
        const pendingRetakes = saved.slots.filter((slot) => slot.pendingPhotoId);
        if (pendingRetakes.length) setRetakeBusySlot(pendingRetakes[0]!.slotNumber);
        for (const slot of pendingRetakes) await finishPendingRetake(saved.id, slot);
        setRetakeBusySlot(null);
        resetActivity();
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
      setErrorMessage(toErrorMessage(error, 'Could not resume the session. Saved originals are safe.'));
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
      setErrorMessage(toErrorMessage(error, 'Could not back up the session. It remains available.'));
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
        resetActivity();
        await loadReviewSession(sessionId);
        await refreshUnfinishedSessions();
      } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not finish the saved retake.')); }
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
      const pending = await bridge.saveRetakeOriginalPhoto(sessionId, slot.slotNumber, await blobToBytes(original.blob), original.width, original.height);
      await saveGuestDownloadCopy(bridge, pending.photoId, original.blob);
      setPreviewImage(original.blob);
      setStatus('Retake photo saved.');
      await bridge.commitRetake(sessionId, slot.slotNumber, pending.photoId);
      await loadReviewSession(sessionId);
      setStatus(`Photo ${slot.slotNumber} replaced · previous version saved`);
      resetActivity();
      await wait(700);
      setPhotoPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return ''; });
      await refreshUnfinishedSessions();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, 'Retake failed. Your saved photos are safe.'));
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
      setErrorMessage(toErrorMessage(error, 'Could not restore the previous photo.'));
    } finally { setBusy(false); }
  };

  const handlePrinterChange = (printerName: string): void => {
    setSelectedPrinterName(printerName);
    void savePreference('selectedPrinterName', printerName).catch(() => setErrorMessage('Could not save the printer choice.'));
  };

  /**
   * Prints are queued, not sent directly (F18): the queue survives a pause or a restart, and
   * the per-session limit is enforced by the repository, so a reprint cannot overspend paper.
   */
  const sendPrintJob = async (activeSessionId: string): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !selectedPrinterName) { setPrintStatus('No printer selected. Choose one, then print.'); return; }
    try {
      const job = await bridge.enqueuePrintJob(activeSessionId, selectedPrinterName);
      setPrintJobId(job.id);
      setPrintStatus(`Queued · ${job.printerName}`);
      await refreshPrintQueue(event?.id);
    } catch (error) { setPrintStatus(`Failed · ${toErrorMessage(error, 'printer error')}`); }
  };

  const handleReprint = async (): Promise<void> => {
    const bridge = window.photobooth;
    if (!sessionId || !bridge || !selectedPrinterName) { setPrintStatus('Choose a printer before printing.'); return; }
    setBusy(true);
    try {
      const previous = printJobs.find((job) => job.sessionId === sessionId && job.status !== 'cancelled');
      const job = previous ? await bridge.reprintJob(previous.id) : await bridge.enqueuePrintJob(sessionId, selectedPrinterName);
      setPrintJobId(job.id);
      setPrintStatus(`Queued · ${job.printerName}`);
      await refreshPrintQueue(event?.id);
    } catch (error) { setPrintStatus(`Failed · ${toErrorMessage(error, 'printer error')}`); }
    finally { setBusy(false); }
  };

  const handleSetPrintPaused = async (paused: boolean): Promise<void> => {
    if (!window.photobooth) return;
    try {
      await window.photobooth.setPrintQueuePaused(paused);
      setPrintStatus(paused ? 'Print queue paused — nothing is sent to the printer.' : 'Print queue resumed.');
      await refreshPrintQueue(event?.id);
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not change the print queue.')); }
  };

  const handleCancelPrintJob = async (jobId: string): Promise<void> => {
    if (!window.photobooth) return;
    try {
      await window.photobooth.cancelPrintJob(jobId);
      await refreshPrintQueue(event?.id);
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not cancel that print.')); }
  };

  const handleContinue = async (): Promise<void> => {
    if (!reviewRecord || !sessionId || !window.photobooth || !event) return;
    setBusy(true);
    setErrorMessage('');
    setStatus('Building your layout…');
    try {
      const template = await loadLayoutDocument(reviewRecord.layoutId);
      let nextShareUrl = '';
      let qrDataUrl = '';
      if (downloadBaseUrl) {
        try {
          const link = await window.photobooth.createShareLink(sessionId);
          nextShareUrl = link.url;
          qrDataUrl = await QRCode.toDataURL(link.url, { width: 256, margin: 1, errorCorrectionLevel: 'Q' });
          setShareStatus(`Link expires ${new Date(link.expiresAt).toLocaleDateString()}`);
        } catch (error) { setShareStatus(toErrorMessage(error, 'QR downloads are not available.')); }
      } else setShareStatus('Set the public HTTPS download URL on the start screen to enable QR downloads.');
      const blob = await renderTemplateLayout(window.photobooth, reviewRecord, template, {
        eventName: event.name, qrDataUrl: qrDataUrl || undefined,
        branding: { primaryColor: event.primaryColor, accentColor: event.accentColor, thankYouText: event.thankYouText, logoDataUrl: eventLogoDataUrl },
      });
      const savedPath = await window.photobooth.saveSessionOutput(sessionId, await blobToBytes(blob), template.page.widthPx, template.page.heightPx);
      // A strip is paired with a second copy on one 4 × 6 sheet (F18) so printing needs only
      // one cut. If pairing fails the strip still prints on its own, so the guest is not held up.
      if (template.page.id === '2x6-strip') {
        try {
          const sheet = await composeStripCutSheet(blob, template.page.widthPx, template.page.heightPx);
          await window.photobooth.savePrintSheet(sessionId, await blobToBytes(sheet.blob), sheet.width, sheet.height);
        } catch { /* the strip still prints on its own */ }
      }
      // Queueing is local and idempotent; a failure here must never hold up the guest.
      void window.photobooth.enqueueSessionUploads(sessionId).catch(() => setQueueWarning('This session could not be queued for sync. The photos are saved locally.'));
      void refreshUploadQueue();
      setShareUrl(nextShareUrl);
      setFinalOutputUrl((current) => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
      setStatus(`Finished layout saved · ${savedPath}`);
      setScreen('finished');
      const autoPrint = decideAutoPrint(event, selectedPrinterName);
      if (autoPrint.shouldPrint) await sendPrintJob(sessionId);
      else setPrintStatus(autoPrint.status);
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not build the finished layout. Your photos are safe.')); }
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
    // The loop comes back after every session, so the next guest sees the invite (F19). In
    // operator mode the settings stay put; the next idle minute brings the loop back.
    setAttractVisible(Boolean(event?.attractEnabled) && (pinConfigured || adminLocked));
    void refreshUnfinishedSessions();
  };

  const handleAddAttractMedia = async (): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !event) return;
    setBusy(true);
    try {
      await bridge.addAttractMedia(event.id);
      await refreshAttractMedia(event.id);
      setEventMessage('Attract screen media updated. The loop is available on the idle screen.');
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not add that attract screen file.')); }
    finally { setBusy(false); }
  };

  const handleRemoveAttractMedia = async (mediaId: string): Promise<void> => {
    const bridge = window.photobooth;
    if (!bridge || !event) return;
    setBusy(true);
    try {
      await bridge.removeAttractMedia(event.id, mediaId);
      await refreshAttractMedia(event.id);
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not remove that attract screen file.')); }
    finally { setBusy(false); }
  };

  const handleDiskWarningChange = (value: string): void => setDiskWarningGB(value);
  const saveDiskWarning = (): void => {
    const threshold = Number(diskWarningGB);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > MAX_DISK_WARNING_GB) { setDiskWarningGB('2'); return; }
    setDiskWarningGB(String(threshold));
    void savePreference('lowDiskWarningGB', String(threshold)).catch(() => setErrorMessage('Could not save the disk warning threshold.'));
  };
  const handleShowGalleryLink = async (): Promise<void> => {
    if (!window.photobooth || !event) return;
    try {
      const link = await window.photobooth.createGalleryLink(event.id);
      setGalleryLink(link.url);
      setEventMessage(link.passwordProtected ? 'Gallery link ready (password protected).' : 'Gallery link ready. Set a password if guests should not open it freely.');
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not create the gallery link. Set the public HTTPS download URL first.')); }
  };

  const handleRemoveGalleryPassword = async (): Promise<void> => {
    if (!window.photobooth || !eventDraft?.id) return;
    try {
      await window.photobooth.setGalleryPassword(eventDraft.id, null);
      const active = await window.photobooth.getActiveEvent().catch(() => null);
      if (active) await loadEventBrand(active);
      setEventMessage('Gallery password removed.');
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not remove the gallery password.')); }
  };

  const handleDeleteSession = async (): Promise<void> => {
    if (!window.photobooth || !sessionId) return;
    try {
      const result = await window.photobooth.deleteSession(sessionId);
      setQueueWarning('');
      setStatus(`Session deleted · ${result.deletedFiles} files removed`);
      returnToReady();
      await refreshUnfinishedSessions();
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not delete the session. Its photos are still on the booth.')); }
  };

  const handleDeleteEvent = async (): Promise<void> => {
    if (!window.photobooth || !event) return;
    try {
      const result = await window.photobooth.deleteEvent(event.id);
      const remaining = await window.photobooth.listEvents();
      setEvents(remaining);
      setEventMessage(`Event deleted · ${result.deletedSessions} sessions and ${result.deletedFiles} files removed`);
      const active = await window.photobooth.getActiveEvent().catch(() => null);
      if (active) await loadEventBrand(active);
    } catch (error) { setEventMessage(toErrorMessage(error, 'Could not delete the event.')); }
  };

  const handleExportEvent = async (): Promise<void> => {
    if (!window.photobooth || !event) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const exportedTo = await window.photobooth.exportEvent(event.id);
      if (exportedTo) setStatus(`Event exported to ${exportedTo}`);
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Event export failed. Your photos remain safe.')); }
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
    } catch (error) { setErrorMessage(toErrorMessage(error, 'Could not save the event retake limit.')); }
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

  return (
    <main className="booth-app" style={{ '--event-primary': event?.primaryColor ?? DEFAULT_PRIMARY_COLOR, '--event-accent': event?.accentColor ?? DEFAULT_ACCENT_COLOR } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P</span><span>PHOTOBOOTH <b>STUDIO</b></span></div>
        <div className="connection"><span className={`connection-dot ${cameraReady ? 'online' : ''}`} />{status}</div>
      </header>
      <section className="workspace">
        <div className="stage-heading">
          {eventLogoDataUrl && <img className="event-brand-logo" src={eventLogoDataUrl} alt={`${event?.name ?? 'Event'} logo`} />}
          <div>
            <p className="eyebrow">{screen === 'ready' ? 'PHOTO SESSION' : screen === 'capturing' ? 'SESSION IN PROGRESS' : screen === 'finished' ? 'FINISHED LAYOUT' : 'REVIEW YOUR PHOTOS'}</p>
            <h1>{screen === 'ready' ? (event?.welcomeText || 'Frame the moment.') : screen === 'capturing' ? `Photo ${currentSlot} of ${slotCount}` : screen === 'finished' ? (event?.thankYouText || DEFAULT_THANK_YOU_TEXT) : 'Choose a favorite.'}</h1>
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
        {screen === 'ready' && <LayoutPicker choices={layoutChoices.map((summary) => ({ summary, document: layoutDocuments[summary.id] ?? null }))} selectedId={selectedLayoutId} onSelect={setSelectedLayoutId} disabled={isBusy || unfinishedSessions.length > 0} />}
        <div className={`controls-grid ${screen === 'ready' && adminLocked ? 'settings-locked' : ''}`}>
          <label className="control-field"><span>CAMERA</span><select value={selectedCameraId} onChange={(e) => void handleCameraChange(e.target.value)} disabled={isBusy || screen === 'review' || screen === 'finished' || !cameras.length}><option value="" disabled>Select a camera</option>{cameras.map((item, index) => <option key={item.deviceId || index} value={item.deviceId}>{item.label || `Camera ${index + 1}`}</option>)}</select></label>
          <label className="control-field"><span>PREVIEW QUALITY</span><select value={resolution} onChange={(e) => void handleResolutionChange(e.target.value as CameraResolution)} disabled={isBusy || screen === 'review' || screen === 'finished'}>{resolutionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="control-field countdown-setting"><span>COUNTDOWN</span><select value={countdownSeconds} onChange={(e) => void handleCountdownChange(Number(e.target.value))} disabled={isBusy || screen === 'review' || screen === 'finished'}>{Array.from({ length: 8 }, (_, index) => index + 3).map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
          {(screen === 'ready' || screen === 'finished') && <label className="control-field"><span>PRINTER</span><select aria-label="Printer" value={selectedPrinterName} onChange={(e) => handlePrinterChange(e.target.value)} disabled={busy || !window.photobooth}><option value="">Select a printer</option>{printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ' · Default' : ''}</option>)}</select></label>}
          {screen === 'ready' && <label className="control-field"><span>PUBLIC DOWNLOAD URL (HTTPS)</span><input aria-label="Public HTTPS download URL" type="url" placeholder="https://photos.example.com" value={downloadBaseUrl} onChange={(e) => setDownloadBaseUrl(e.target.value)} onBlur={() => void savePreference('downloadBaseUrl', downloadBaseUrl.trim().replace(/\/$/, '')).catch(() => setErrorMessage('Enter a valid HTTPS site URL.'))} disabled={busy || !window.photobooth} /></label>}
          {screen === 'ready' && <label className="control-field"><span>LOW-DISK WARNING (GB)</span><input aria-label="Low-disk warning threshold in gigabytes" type="number" min="0" max="1000" step="0.1" value={diskWarningGB} onChange={(e) => handleDiskWarningChange(e.target.value)} onBlur={saveDiskWarning} disabled={busy || !window.photobooth} /></label>}
          {screen === 'ready' && <label className="control-field"><span>RETAKES PER SESSION</span><div className="retake-limit-control"><input aria-label="Retakes per session" type="number" min="0" step="1" value={retakeLimitDraft} placeholder="0+" onChange={(e) => handleRetakeLimitInput(e.target.value)} onBlur={saveRetakeLimitDraft} disabled={busy || !window.photobooth || event?.retakeLimit === -1} /><button type="button" className="unlimited-button" onClick={() => void handleRetakeLimitChange(event?.retakeLimit === -1 ? 3 : -1)} disabled={busy || !window.photobooth}>{event?.retakeLimit === -1 ? 'Use a limit' : 'Unlimited'}</button></div></label>}
          {screen === 'review' ? <button className="start-button" type="button" onClick={() => void handleContinue()} disabled={isBusy}>Continue <span aria-hidden="true">→</span></button>
            : screen === 'finished' ? <>{!adminLocked && <ConfirmAction className="secondary-button" label="Delete session" question="Delete this session and its photos?" confirmLabel="Yes, delete session" onConfirm={() => void handleDeleteSession()} disabled={busy} />}<button className="secondary-button" type="button" onClick={() => void handleReprint()} disabled={busy || !selectedPrinterName}>Reprint</button><button className="start-button" type="button" onClick={returnToReady} disabled={busy}>Back to start</button></>
              : <><button className="secondary-button" type="button" onClick={() => void handleExportEvent()} disabled={busy || !event || !window.photobooth}>Export event</button><button className="start-button" type="button" onClick={() => void handleStartSession()} disabled={!cameraReady || !event || !pinConfigured || isBusy || unfinishedSessions.length > 0}>Start session <span aria-hidden="true">→</span></button></>}
        </div>
        {screen === 'ready' && !adminLocked && <section className="event-manager-card" aria-label="Event setup and branding">
          <div className="event-manager-heading"><div><p className="eyebrow">EVENT SETUP</p><h2>Event details & branding</h2></div><div className="event-manager-actions"><select aria-label="Active event" disabled={unfinishedSessions.length > 0} value={event?.id ?? ''} onChange={(e) => void handleSelectEvent(e.target.value)}>{events.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="secondary-button" onClick={handleNewEvent} disabled={unfinishedSessions.length > 0}>New event</button><button type="button" className="secondary-button" onClick={() => void handleDuplicateEvent()} disabled={!event || unfinishedSessions.length > 0}>Duplicate active</button><button type="button" className="secondary-button" onClick={() => setEditorOpen(true)} disabled={!window.photobooth}>Layouts…</button><ConfirmAction className="secondary-button" label="Delete event" question="Delete this event, its sessions and their photos?" confirmLabel="Yes, delete event" onConfirm={() => void handleDeleteEvent()} disabled={!event || events.length < 2 || unfinishedSessions.length > 0} /></div></div>
          {eventDraft && <div className="event-form-grid">
            <label>Event name<input aria-label="Event name" maxLength={80} value={eventDraft.name} onChange={(e) => setEventDraft({ ...eventDraft, name: e.target.value })} /></label>
            <label>Event date<input aria-label="Event date" type="date" value={eventDraft.eventDate ?? ''} onChange={(e) => setEventDraft({ ...eventDraft, eventDate: e.target.value || null })} /></label>
            <label>Photo count<select aria-label="Event photo count" value={eventDraft.shots} onChange={(e) => setEventDraft({ ...eventDraft, shots: Number(e.target.value), defaultLayoutId: defaultLayoutIdForShots(Number(e.target.value)) })}>{[1, 2, 3, 4, 5, 6].map((shots) => <option key={shots} value={shots}>{shots} {shots === 1 ? 'photo' : 'photos'}</option>)}</select></label>
            <label>QR link expires after (days)<input aria-label="QR link expiry days" type="number" min={1} max={365} value={eventDraft.expiryDays} onChange={(e) => setEventDraft({ ...eventDraft, expiryDays: Number(e.target.value) })} /></label>
            <label>Prints per session<input aria-label="Prints per session" type="number" min={MIN_PRINT_LIMIT_PER_SESSION} max={MAX_PRINT_LIMIT_PER_SESSION} value={eventDraft.printLimitPerSession} onChange={(e) => setEventDraft({ ...eventDraft, printLimitPerSession: Number(e.target.value) })} /></label>
            <label>Paper sheets loaded (0 = not counted)<input aria-label="Paper count" type="number" min={0} max={MAX_EVENT_PAPER_COUNT} value={eventDraft.paperCount} onChange={(e) => setEventDraft({ ...eventDraft, paperCount: Number(e.target.value) })} /></label>
            <label>Primary color (hex)<input aria-label="Primary color hex" value={eventDraft.primaryColor} maxLength={7} onChange={(e) => setEventDraft({ ...eventDraft, primaryColor: e.target.value })} /></label>
            <label>Accent color (hex)<input aria-label="Accent color hex" value={eventDraft.accentColor} maxLength={7} onChange={(e) => setEventDraft({ ...eventDraft, accentColor: e.target.value })} /></label>
            <label>Welcome text<input aria-label="Event welcome text" maxLength={160} value={eventDraft.welcomeText} onChange={(e) => setEventDraft({ ...eventDraft, welcomeText: e.target.value })} /></label>
            <label>Thank-you text<input aria-label="Event thank-you text" maxLength={160} value={eventDraft.thankYouText} onChange={(e) => setEventDraft({ ...eventDraft, thankYouText: e.target.value })} /></label>
            <label>Contact details on expired links<input aria-label="Event contact details" maxLength={200} placeholder="e.g. Message @partybooth or hello@example.com" value={eventDraft.contactText} onChange={(e) => setEventDraft({ ...eventDraft, contactText: e.target.value })} /></label>
            <div className="watermark-field">
              <label className="watermark-toggle"><input type="checkbox" aria-label="Watermark guest downloads" checked={eventDraft.watermarkEnabled} disabled={!eventLogoDataUrl} onChange={(e) => setEventDraft({ ...eventDraft, watermarkEnabled: e.target.checked })} /> <span>Watermark guest downloads</span></label>
              <p className="gallery-hint">{eventLogoDataUrl ? 'Applied to the downloadable copies and gallery thumbnails only — originals and prints stay clean.' : 'Add an event logo first; the watermark uses that logo.'}</p>
              <label>Watermark corner<select aria-label="Watermark corner" value={eventDraft.watermarkPosition} disabled={!eventDraft.watermarkEnabled} onChange={(e) => setEventDraft({ ...eventDraft, watermarkPosition: e.target.value as WatermarkPosition })}>{['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].map((position) => <option key={position} value={position}>{position.replace('-', ' ')}</option>)}</select></label>
              <label>Watermark size <output>{eventDraft.watermarkScalePercent}% of the photo width</output><input aria-label="Watermark size percent" type="range" min={MIN_WATERMARK_SCALE_PERCENT} max={MAX_WATERMARK_SCALE_PERCENT} step={1} value={eventDraft.watermarkScalePercent} disabled={!eventDraft.watermarkEnabled} onChange={(e) => setEventDraft({ ...eventDraft, watermarkScalePercent: Number(e.target.value) })} /></label>
              <label>Watermark opacity <output>{Math.round(eventDraft.watermarkOpacity * 100)}%</output><input aria-label="Watermark opacity" type="range" min={MIN_WATERMARK_OPACITY} max={MAX_WATERMARK_OPACITY} step={0.05} value={eventDraft.watermarkOpacity} disabled={!eventDraft.watermarkEnabled} onChange={(e) => setEventDraft({ ...eventDraft, watermarkOpacity: Number(e.target.value) })} /></label>
            </div>
            <label>Consent notice for this event<textarea aria-label="Event consent notice" maxLength={1200} rows={3} placeholder="Leave blank to use the booth-wide notice" value={eventDraft.consentText} onChange={(e) => setEventDraft({ ...eventDraft, consentText: e.target.value })} /></label>
            <div className="gallery-field">
              <div>
                <p className="eyebrow">GUEST GALLERY</p>
                <p className="gallery-hint">One link to every session of this event. {eventDraft.galleryPasswordSet ? 'A password is set; leave the field blank to keep it.' : 'No password yet.'}</p>
              </div>
              <label>Gallery password<input aria-label="Gallery password" type="password" maxLength={64} autoComplete="new-password" placeholder={eventDraft.galleryPasswordSet ? 'Type to replace the password' : 'Optional, 4 to 64 characters'} value={galleryPasswordDraft} onChange={(e) => setGalleryPasswordDraft(e.target.value)} /></label>
              <div className="gallery-actions">
                <button type="button" className="secondary-button" onClick={() => void handleShowGalleryLink()} disabled={!event || !window.photobooth}>Show gallery link</button>
                {eventDraft.galleryPasswordSet && <button type="button" className="secondary-button" onClick={() => void handleRemoveGalleryPassword()} disabled={!eventDraft.id}>Remove gallery password</button>}
              </div>
              {galleryLink && <input aria-label="Gallery link" readOnly value={galleryLink} onFocus={(e) => e.currentTarget.select()} />}
            </div>
            <div className="attract-field">
              <div className="attract-field-heading">
                <label className="attract-toggle"><input type="checkbox" aria-label="Show attract screen when idle" checked={eventDraft.attractEnabled} onChange={(e) => setEventDraft({ ...eventDraft, attractEnabled: e.target.checked })} /> <span>Invite guests in on an idle attract screen</span></label>
                <button type="button" className="secondary-button" onClick={() => setAttractVisible(true)} disabled={!event || busy || unfinishedSessions.length > 0}>Preview attract screen</button>
              </div>
              <label>Wait before showing it (seconds)<input aria-label="Attract screen idle seconds" type="number" min={MIN_ATTRACT_IDLE_SECONDS} max={MAX_ATTRACT_IDLE_SECONDS} value={eventDraft.attractIdleSeconds} disabled={!eventDraft.attractEnabled} onChange={(e) => setEventDraft({ ...eventDraft, attractIdleSeconds: Number(e.target.value) })} /></label>
              <AttractMediaField media={attractMedia} busy={busy} disabled={unfinishedSessions.length > 0 || !event} onAdd={() => void handleAddAttractMedia()} onRemove={(mediaId) => void handleRemoveAttractMedia(mediaId)} />
            </div>
            <GuestLayoutField templates={templates} defaultLayoutId={eventDraft.defaultLayoutId} offeredLayoutIds={eventDraft.offeredLayoutIds} onChange={(offeredLayoutIds) => setEventDraft({ ...eventDraft, offeredLayoutIds })} />
            <div className="event-logo-field">{eventLogoDataUrl ? <img src={eventLogoDataUrl} alt="Selected event logo preview" /> : <span>No logo selected</span>}<button type="button" className="secondary-button" onClick={() => void handleChooseEventLogo()} disabled={unfinishedSessions.length > 0}>Choose PNG/JPEG logo</button><small>Files are copied locally; limit 5 MB.</small></div>
            <button type="button" className="start-button" onClick={() => void handleSaveEvent()} disabled={unfinishedSessions.length > 0}>Save and use this event</button>
          </div>}
          {eventMessage && <p className="event-message" role="status">{eventMessage}</p>}
        </section>}
        {screen === 'ready' && <section className="admin-security-card" aria-label="Operator security">
          {!pinConfigured ? <><p className="eyebrow">FIRST-TIME SETUP</p><h2>Create admin PIN</h2><p>Set a PIN before starting guest sessions. Use 6 to 12 digits and keep it private.</p><label>New PIN<input aria-label="New admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>Confirm PIN<input aria-label="Confirm admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} /></label><button type="button" onClick={() => void savePin()}>Save admin PIN</button></>
            : adminLocked ? <><p className="eyebrow">GUEST MODE</p><h2>Booth locked</h2><p>Operator settings are hidden. Enter the admin PIN to unlock them.</p>{showUnlock ? <><label>Admin PIN<input aria-label="Admin PIN to unlock settings" type="password" inputMode="numeric" maxLength={12} autoComplete="current-password" value={currentPinDraft} onChange={(e) => setCurrentPinDraft(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void unlockAdmin(); }} /></label><button type="button" onClick={() => void unlockAdmin()}>Unlock settings</button><button type="button" className="secondary-button" onClick={() => { setShowUnlock(false); setCurrentPinDraft(''); setPinError(''); }}>Cancel</button></> : <button type="button" onClick={() => { setShowUnlock(true); setPinError(''); }}>Operator unlock</button>}</>
              : <><p className="eyebrow">OPERATOR SETTINGS</p><h2>Admin access</h2><label>Current PIN<input aria-label="Current admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="current-password" value={currentPinDraft} onChange={(e) => setCurrentPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>New PIN<input aria-label="Replacement admin PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} /></label><label>Confirm new PIN<input aria-label="Confirm replacement PIN" type="password" inputMode="numeric" maxLength={12} autoComplete="new-password" value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} /></label><button type="button" onClick={() => void savePin()}>Change admin PIN</button><label>Consent notice shown before every session<textarea aria-label="Consent notice wording" maxLength={1200} value={consentText} onChange={(e) => setConsentText(e.target.value)} onBlur={() => void savePreference('consentText', consentText).catch((error: unknown) => setPinError(toErrorMessage(error, 'Could not save consent text.')))} /></label><p className="consent-retention-note">This is the booth-wide notice. An event with its own consent wording uses that instead.</p><button type="button" onClick={() => { setAdminLocked(true); setShowUnlock(false); setPinError(''); setPinDraft(''); setPinConfirm(''); setCurrentPinDraft(''); }}>Lock guest mode</button><button type="button" className="secondary-button" onClick={() => { setExitPrompt(true); setExitPin(''); setPinError(''); }}>Exit booth…</button></>}
          {pinError && <p className="pin-error" role="alert">{pinError}</p>}
        </section>}
        {editorOpen && window.photobooth && <TemplateEditor bridge={window.photobooth} logoDataUrl={eventLogoDataUrl} onClose={() => setEditorOpen(false)} onTemplatesChanged={(listing) => { setTemplates(listing); setSelectedLayoutId((current) => listing.some((item) => item.id === current) ? current : listing[0]?.id ?? current); }} />}
        {consentOpen && <ConsentDialog text={event?.consentText.trim() ? event.consentText : consentText} onDecline={() => setConsentOpen(false)} onAccept={() => void confirmConsentAndStart()} />}
        {exitPrompt && <ExitDialog pin={exitPin} error={pinError} onPinChange={setExitPin} onCancel={() => { setExitPrompt(false); setExitPin(''); setPinError(''); }} onSubmit={() => void submitExit()} />}
        {screen === 'finished' && <p className="share-status" role="status">{shareUrl ? <>Scan to download: <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a> · {shareStatus}</> : shareStatus}</p>}
        {screen === 'finished' && <p className={`print-status ${printStatus.startsWith('Failed') ? 'failed' : printStatus.startsWith('Done') ? 'done' : ''}`} role="status">{printStatus}</p>}
        {screen === 'finished' && event && <p className="print-limit-note">Prints this session: {printJobs.filter((job) => job.sessionId === sessionId && job.status !== 'cancelled').length} of {event.printLimitPerSession}{printSummary?.paperWarning ? ` · ${printSummary.paperWarning}` : ''}</p>}
        {screen === 'capturing' && <SlotProgress slotCount={slotCount} currentSlot={currentSlot} capturedSlots={capturedSlots} />}
        {screen === 'review' && reviewRecord && <ReviewSection record={reviewRecord} images={reviewImages} isBusy={isBusy} cameraReady={cameraReady} onRetake={(slot) => void handleRetake(slot)} onRevert={(slot) => void handleRevert(slot)} />}
        {unfinishedSessions.length > 0 && screen === 'ready' && !adminLocked && <RecoveryCard session={unfinishedSessions[0]!} busy={busy} cameraReady={cameraReady} onResume={() => void handleResumeSession(unfinishedSessions[0]!)} onDiscard={() => void handleDiscardSession(unfinishedSessions[0]!)} />}
        {screen === 'ready' && !adminLocked && uploadQueue && <UploadQueueCard summary={uploadQueue} />}
        {screen === 'ready' && !adminLocked && printSummary && <PrintQueueCard summary={printSummary} jobs={printJobs} busy={busy} onSetPaused={(paused) => void handleSetPrintPaused(paused)} onCancel={(jobId) => void handleCancelPrintJob(jobId)} />}
        {screen === 'ready' && !adminLocked && retention && <RetentionNote status={retention} />}
        {screen === 'ready' && !adminLocked && queueWarning && <p className="pin-error" role="alert">{queueWarning}</p>}
        {errorMessage && <p className="camera-error" role="alert">{errorMessage}<button type="button" onClick={() => void refreshCameras()}>Retry</button></p>}
        {!errorMessage && <p className="helper-note">Originals stay on this booth. No photos are uploaded in this feature.</p>}
      </section>
      <footer className="app-footer"><span>OFFLINE-READY · PRIVATE BY DESIGN</span><span>{event?.name.toUpperCase() ?? 'CAMERA SETUP'}</span></footer>
      {attractVisible && event && <AttractScreen
        event={event}
        logoDataUrl={eventLogoDataUrl}
        slides={attractSlides}
        layouts={layoutChoices.flatMap((choice) => {
          const document = layoutDocuments[choice.id];
          return document ? [{ id: choice.id, label: choice.name, document }] : [];
        })}
        onStart={() => setAttractVisible(false)}
      />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
