/** Shared watermark vocabulary: events store it, the capture pipeline draws it. */
export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export type WatermarkSettings = {
  position: WatermarkPosition;
  /** Logo width as a percentage of the photo width; the height follows the logo's aspect. */
  scalePercent: number;
  /** 0.1–1; only the logo is drawn at this alpha, the photo is never dimmed. */
  opacity: number;
};
