/**
 * MJPEG framing (F22): every browser can show a `multipart/x-mixed-replace` stream in a plain
 * `<img>`, which is the least code that streams the booth camera to a tablet.
 */
export const MJPEG_BOUNDARY = 'photoboothframe';
export const MJPEG_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`;

export function mjpegHeaders(): Record<string, string> {
  return {
    'Content-Type': MJPEG_CONTENT_TYPE,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Connection': 'close',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  };
}

export function mjpegPart(jpeg: Uint8Array): Buffer {
  return Buffer.concat([
    Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`, 'utf8'),
    Buffer.from(jpeg),
    Buffer.from('\r\n', 'utf8'),
  ]);
}
