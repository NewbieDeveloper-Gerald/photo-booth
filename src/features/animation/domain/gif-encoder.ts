/**
 * A small GIF89a encoder (F23). No dependency, no Node APIs: it takes already-sized RGBA
 * frames and writes an animated GIF with one shared 256-colour palette.
 *
 * The palette is 3-3-2 (8 levels of red, 8 of green, 4 of blue). Eight-bit-per-channel colour
 * would need a quantiser for every frame; 3-3-2 is exact, fast, and its banding is invisible at
 * the size these loops are shown (a phone screen, next to the photos).
 */
export type GifFrame = {
  /** RGBA, `width * height * 4` bytes. A leading alpha of 0 means the pixel is transparent. */
  rgba: Uint8Array | Uint8ClampedArray;
};

export type GifOptions = {
  width: number;
  height: number;
  /** Frame delay in hundredths of a second; GIF has no finer unit. */
  delayCs: number;
  /** 0 means loop forever. */
  loop?: number;
};

export const GIF_MAX_EDGE_PX = 320;

/** Every colour the palette can hold, index order: 0 is transparent, then 3-3-2. */
const CLEAR_CODE = 256;
const END_CODE = 257;
const MIN_CODE_SIZE = 8;

function assertFrame(frame: GifFrame, width: number, height: number): void {
  if (frame.rgba.length !== width * height * 4) throw new Error('Every GIF frame must match the animation size');
}

/** Index 0 is reserved for transparency; 1..255 use 3-3-2 bits of the pixel. */
export function paletteIndex(red: number, green: number, blue: number, alpha = 255): number {
  if (alpha < 128) return 0;
  const index = 1 + (((red >> 5) & 0x07) << 5) + (((green >> 5) & 0x07) << 2) + ((blue >> 6) & 0x03);
  return Math.min(255, index);
}

/** The palette the encoder writes, in the same index order, so a decoder or a test can check it. */
export function colorTable(): Uint8Array {
  const table = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    const value = index === 0 ? 0 : index - 1;
    table[index * 3] = (((value >> 5) & 0x07) * 255 + 3) >> 3;
    table[index * 3 + 1] = (((value >> 2) & 0x07) * 255 + 3) >> 3;
    table[index * 3 + 2] = ((value & 0x03) * 255 + 1) >> 2;
  }
  return table;
}

function indexedFrame(frame: GifFrame): Uint8Array {
  const pixels = new Uint8Array(frame.rgba.length / 4);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    pixels[index] = paletteIndex(frame.rgba[offset]!, frame.rgba[offset + 1]!, frame.rgba[offset + 2]!, frame.rgba[offset + 3]!);
  }
  return pixels;
}

/**
 * GIF's LZW: variable code width, a clear code, an end code, and codes packed least
 * significant bit first into 255-byte sub-blocks.
 */
function lzwCompress(pixels: Uint8Array): Buffer {
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const flush = (code: number, width: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let codeWidth = MIN_CODE_SIZE + 1;
  let nextCode = END_CODE + 1;
  const dictionary = new Map<number, number>();
  flush(CLEAR_CODE, codeWidth);

  let prefix = pixels[0] ?? 0;
  for (let index = 1; index < pixels.length; index += 1) {
    const next = pixels[index]!;
    const key = (prefix << 8) | next;
    const existing = dictionary.get(key);
    if (existing !== undefined) { prefix = existing; continue; }
    flush(prefix, codeWidth);
    if (nextCode === 4096) {
      flush(CLEAR_CODE, codeWidth);
      dictionary.clear();
      codeWidth = MIN_CODE_SIZE + 1;
      nextCode = END_CODE + 1;
    } else {
      dictionary.set(key, nextCode);
      nextCode += 1;
      // A decoder's table is one entry behind this counter, and it widens when its own table
      // reaches 2^w; widening here at 2^w + 1 keeps the two in step (checked against a GIF
      // written by a real encoder, which grows three times in 8575 pixels).
      if (nextCode > (1 << codeWidth) && codeWidth < 12) codeWidth += 1;
    }
    prefix = next;
  }
  flush(prefix, codeWidth);
  flush(END_CODE, codeWidth);
  if (bitCount > 0) out.push(bitBuffer & 0xff);

  const blocks: Buffer[] = [];
  for (let offset = 0; offset < out.length; offset += 255) {
    const chunk = out.slice(offset, offset + 255);
    blocks.push(Buffer.from([chunk.length, ...chunk]));
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

/** GIF stores every multi-byte number little-endian. */
function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

/**
 * Builds the whole file: header, one global palette, the looping extension, and one image
 * block per frame with a 4/100 s delay. Every frame is drawn over the previous one, which is
 * why a poster of opaque photos needs no local palettes or disposal tricks.
 */
export function encodeGif(frames: GifFrame[], options: GifOptions): Buffer {
  const { width, height, delayCs, loop = 0 } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65_535 || height > 65_535) throw new Error('Invalid GIF size');
  if (!Number.isInteger(delayCs) || delayCs < 0 || delayCs > 65_535) throw new Error('Invalid GIF frame delay');
  if (frames.length === 0) throw new Error('A GIF needs at least one frame');
  for (const frame of frames) assertFrame(frame, width, height);

  const header = Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    u16(width), u16(height),
    // Global palette, 8-bit colour resolution, 256 entries (2^(7+1)).
    Buffer.from([0xf7, 0x00, 0x00]),
    Buffer.from(colorTable()),
    // NETSCAPE2.0: loop forever by default so the loop plays on every phone.
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'latin1'),
    Buffer.from([0x03, 0x01]), u16(loop), Buffer.from([0x00]),
  ]);

  const body: Buffer[] = [];
  for (const frame of frames) {
    body.push(
      // Graphic control: keep the frame in place (disposal 1), index 0 transparent, then the delay.
      Buffer.from([0x21, 0xf9, 0x04, 0x05]), u16(delayCs), Buffer.from([0x00, 0x00]),
      // Image descriptor: full frame, no local colour table, not interlaced.
      Buffer.from([0x2c]), u16(0), u16(0), u16(width), u16(height), Buffer.from([0x00]),
      Buffer.from([MIN_CODE_SIZE]),
      lzwCompress(indexedFrame(frame)),
    );
  }
  return Buffer.concat([header, ...body, Buffer.from([0x3b])]);
}
