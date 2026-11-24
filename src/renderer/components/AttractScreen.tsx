import React, { useEffect, useState } from 'react';
import type { ActiveEvent } from '../../shared/types/event';
import type { TemplateDocument } from '../../features/layouts';
import { ATTRACT_SLIDE_MS } from '../../shared/constants/limits';
import type { AttractSlide } from '../lib/attract-slides';
import { LayoutPreview } from './LayoutPreview';

type AttractScreenProps = {
  event: ActiveEvent;
  logoDataUrl: string | null;
  slides: AttractSlide[];
  /** Shown when the event has no media yet, so the loop still invites guests in. */
  layouts: Array<{ id: string; label: string; document: TemplateDocument }>;
  onStart: () => void;
};

/**
 * The idle loop (F19): a full-bleed slideshow of the event's photos or clips over the event's
 * colours, with "Touch to start". It replaces the operator screen while the booth is waiting,
 * so a guest never sees the printer list or the event form. A touch anywhere returns to the
 * booth; the button says so plainly rather than hiding the interaction.
 */
export function AttractScreen({ event, logoDataUrl, slides, layouts, onStart }: AttractScreenProps): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const total = slides.length + (slides.length === 0 ? layouts.length : 0);
  /** Identity of the loop's contents, so a re-render with the same list does not restart it. */
  const signature = `${slides.map((item) => item.id).join('|')}#${layouts.map((item) => item.id).join('|')}`;

  useEffect(() => { setIndex(0); }, [signature]);

  useEffect(() => {
    if (total <= 1) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % total), ATTRACT_SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [total]);

  const slide = slides.length > 0 ? slides[index % slides.length] : undefined;
  const layout = slides.length === 0 && layouts.length > 0 ? layouts[index % layouts.length] : undefined;

  return (
    <div
      className="attract-screen"
      aria-label="Attract screen"
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(perform) => { if (perform.key === 'Enter' || perform.key === ' ') onStart(); }}
      style={{ background: `radial-gradient(ellipse at 50% 40%, ${event.primaryColor}33 0%, #0c0e15 62%)` }}
    >
      <div className="attract-media">
        {slide?.kind === 'image' && <img src={slide.url} alt={slide.label} />}
        {slide?.kind === 'video' && <video src={slide.url} autoPlay muted loop playsInline aria-label={slide.label} />}
        {layout && <div className="attract-layout"><LayoutPreview document={layout.document} label={layout.label} /></div>}
        {!slide && !layout && <div className="attract-blank" aria-hidden="true" />}
      </div>
      <div className="attract-copy">
        {logoDataUrl && <img className="attract-logo" src={logoDataUrl} alt="" />}
        <p className="eyebrow" style={{ color: event.accentColor }}>{event.name}</p>
        <h1>{event.welcomeText || 'Frame the moment.'}</h1>
        <p className="attract-invite">Touch to start</p>
        <p className="attract-hint">Tap anywhere to open the booth</p>
      </div>
    </div>
  );
}
