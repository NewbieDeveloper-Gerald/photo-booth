import { describe, expect, it } from 'vitest';
import { MJPEG_BOUNDARY, MJPEG_CONTENT_TYPE, mjpegHeaders, mjpegPart } from './mjpeg';

describe('MJPEG framing (F22)', () => {
  it('announces a multipart stream the browser can show in an img tag', () => {
    expect(MJPEG_CONTENT_TYPE).toBe(`multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`);
    const headers = mjpegHeaders();
    expect(headers['Content-Type']).toBe(MJPEG_CONTENT_TYPE);
    expect(headers['Cache-Control']).toContain('no-store');
    expect(headers['X-Robots-Tag']).toContain('noindex');
  });

  it('wraps each JPEG with its boundary, type and length', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const part = mjpegPart(jpeg);
    const head = Buffer.from(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\n`);
    expect(part.subarray(0, head.length)).toEqual(head);
    expect(part.subarray(head.length, head.length + 4)).toEqual(Buffer.from(jpeg));
    expect(part.subarray(head.length + 4).toString()).toBe('\r\n');
  });
});
