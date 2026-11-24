import React from 'react';
import { paintOrder, type TemplateDocument } from '../../features/layouts';

const PAGE_PAPER = '#ffffff';
const PHOTO_FRAME = '#e5e7eb';
const PHOTO_PLACEHOLDER = '#cbd5e1';
const TEXT_PLACEHOLDER = '#94a3b8';

/**
 * The guest picker draws layouts as SVG instead of canvas: a dozen previews at once
 * stay cheap to paint, they scale crisply on any screen, and the geometry comes from
 * the very same elements the printer uses, so the shape always matches the print.
 */
export function LayoutPreview({ document, label }: { document: TemplateDocument; label: string }): React.JSX.Element {
  const { widthPx, heightPx } = document.page;
  return (
    <svg className="layout-preview" role="img" aria-label={`${label} preview`} viewBox={`0 0 ${widthPx} ${heightPx}`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={widthPx} height={heightPx} fill={PAGE_PAPER} />
      {paintOrder(document).map((element) => {
        if (element.kind === 'photo') {
          return (
            <g key={element.id} data-slot={element.slotNumber}>
              <rect x={element.x - element.frameGutter / 2} y={element.y - element.frameGutter / 2} width={element.width + element.frameGutter} height={element.height + element.frameGutter} fill={PHOTO_FRAME} />
              <rect x={element.x} y={element.y} width={element.width} height={element.height} fill={PHOTO_PLACEHOLDER} />
              <text x={element.x + element.width / 2} y={element.y + element.height / 2} fill="#475569" fontWeight={600} fontSize={element.height * 0.3} textAnchor="middle" dominantBaseline="central">{element.slotNumber}</text>
            </g>
          );
        }
        if (element.kind === 'rect') return <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.color} />;
        if (element.kind === 'text') return <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={TEXT_PLACEHOLDER} opacity={0.2} />;
        if (element.kind === 'logo') return <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill="none" stroke={TEXT_PLACEHOLDER} strokeWidth={Math.max(2, widthPx / 300)} />;
        if (element.kind === 'qr') return <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.panelColor} />;
        return <rect key={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={PHOTO_PLACEHOLDER} />;
      })}
    </svg>
  );
}
