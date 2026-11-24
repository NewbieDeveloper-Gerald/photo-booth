import React, { useCallback, useEffect, useRef, useState } from 'react';
import { elementAtPoint, moveElement, paintTemplatePreview, resizeElement, snapAlongAxis, type TemplateDocument, type TemplateElement } from '../../features/layouts';

const HANDLE_SIZE_PX = 26;
const SELECTION_COLOR = '#2563eb';

type Point = { x: number; y: number };
type DragState =
  | { mode: 'move'; elementId: string; start: Point; origin: Point }
  | { mode: 'resize'; elementId: string; start: Point; origin: { width: number; height: number } };

type TemplateEditorCanvasProps = {
  document: TemplateDocument;
  selectedId: string | null;
  onSelect: (elementId: string | null) => void;
  onCommit: (next: TemplateDocument) => void;
  images: Map<string, ImageBitmap>;
};

/** The page, drawn at print geometry, with click-to-select, drag-to-move and corner resize. */
export function TemplateEditorCanvas({ document, selectedId, onSelect, onCommit, images }: TemplateEditorCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<TemplateDocument | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const shown = draft ?? document;

  const toPagePoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (document.page.widthPx / rect.width),
      y: (event.clientY - rect.top) * (document.page.heightPx / rect.height),
    };
  }, [document.page.widthPx, document.page.heightPx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = shown.page.widthPx;
    canvas.height = shown.page.heightPx;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    paintTemplatePreview(context, shown, { images });
    const selected = shown.elements.find((element) => element.id === selectedId);
    if (selected) {
      context.strokeStyle = SELECTION_COLOR;
      context.lineWidth = 4;
      context.setLineDash([12, 8]);
      context.strokeRect(selected.x, selected.y, selected.width, selected.height);
      context.setLineDash([]);
      context.fillStyle = SELECTION_COLOR;
      context.fillRect(selected.x + selected.width - HANDLE_SIZE_PX / 2, selected.y + selected.height - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
    }
  }, [shown, selectedId, images]);

  const isOnHandle = (element: TemplateElement, point: Point): boolean =>
    point.x >= element.x + element.width - HANDLE_SIZE_PX && point.x <= element.x + element.width + HANDLE_SIZE_PX
    && point.y >= element.y + element.height - HANDLE_SIZE_PX && point.y <= element.y + element.height + HANDLE_SIZE_PX;

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPagePoint(event);
    const selected = document.elements.find((element) => element.id === selectedId);
    if (selected && isOnHandle(selected, point)) {
      dragRef.current = { mode: 'resize', elementId: selected.id, start: point, origin: { width: selected.width, height: selected.height } };
      return;
    }
    const hit = elementAtPoint(document, point);
    onSelect(hit?.id ?? null);
    dragRef.current = hit ? { mode: 'move', elementId: hit.id, start: point, origin: { x: hit.x, y: hit.y } } : null;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toPagePoint(event);
    if (drag.mode === 'move') {
      // Snap from the drag origin so the element does not creep while the pointer moves.
      const next = moveElement(draft ?? document, drag.elementId, { dx: 0, dy: 0 });
      const x = snapAlongAxis({ value: drag.origin.x + (point.x - drag.start.x), size: next.elements.find((element) => element.id === drag.elementId)!.width, limit: document.page.widthPx });
      const y = snapAlongAxis({ value: drag.origin.y + (point.y - drag.start.y), size: next.elements.find((element) => element.id === drag.elementId)!.height, limit: document.page.heightPx });
      setDraft({ ...next, elements: next.elements.map((element) => element.id === drag.elementId ? { ...element, x, y } : element) });
    } else {
      const width = drag.origin.width + (point.x - drag.start.x);
      const height = drag.origin.height + (point.y - drag.start.y);
      setDraft(resizeElement(draft ?? document, drag.elementId, { width, height }));
    }
  };

  const handlePointerUp = (): void => {
    dragRef.current = null;
    if (draft) onCommit(draft);
    setDraft(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="template-editor-canvas"
      aria-label="Layout editor canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
