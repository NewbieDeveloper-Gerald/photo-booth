import { describe, expect, it } from 'vitest';
import { GIF_MAX_EDGE_PX, colorTable, encodeGif, paletteIndex, type GifFrame } from './gif-encoder';

/** A tiny GIF reader, so the encoder is checked against a decoder rather than against itself. */
type Decoded = { width: number; height: number; loop: number; delayCs: number; palette: Uint8Array; frames: Uint8Array[] };

function decodeGif(buffer: Buffer): Decoded {
  if (buffer.subarray(0, 6).toString('latin1') !== 'GIF89a') throw new Error('not a GIF89a');
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10]!;
  if ((packed & 0x80) === 0) throw new Error('no global colour table');
  const tableSize = 2 ** ((packed & 0x07) + 1);
  let offset = 13;
  const palette = buffer.subarray(offset, offset + tableSize * 3);
  offset += tableSize * 3;
  let loop = -1;
  let delayCs = 0;
  const frames: Uint8Array[] = [];
  while (offset < buffer.length) {
    const block = buffer[offset]!;
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = buffer[offset + 1]!;
      offset += 2;
      if (label === 0xff) {
        const size = buffer[offset]!;
        const name = buffer.subarray(offset + 1, offset + 1 + size).toString('latin1');
        offset += 1 + size;
        const subSize = buffer[offset]!;
        if (name === 'NETSCAPE2.0') loop = buffer.readUInt16LE(offset + 2);
        offset += 1 + subSize + 1;
      } else if (label === 0xf9) {
        const size = buffer[offset]!;
        delayCs = buffer.readUInt16LE(offset + 2);
        offset += 1 + size + 1;
      } else {
        const size = buffer[offset]!;
        offset += 1 + size + 1;
      }
      continue;
    }
    if (block !== 0x2c) throw new Error(`unexpected block ${block}`);
    const frameWidth = buffer.readUInt16LE(offset + 5);
    const frameHeight = buffer.readUInt16LE(offset + 7);
    offset += 10;
    const minCodeSize = buffer[offset]!;
    offset += 1;
    const data: number[] = [];
    for (;;) {
      const size = buffer[offset]!;
      offset += 1;
      if (size === 0) break;
      data.push(...buffer.subarray(offset, offset + size));
      offset += size;
    }
    frames.push(lzwDecode(Uint8Array.from(data), minCodeSize, frameWidth * frameHeight));
  }
  return { width, height, loop, delayCs, palette, frames };
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeWidth = minCodeSize + 1;
  let dictionary: number[][] = [];
  const reset = (): void => {
    dictionary = [];
    for (let index = 0; index < clear; index += 1) dictionary.push([index]);
    dictionary.push([], []);
    codeWidth = minCodeSize + 1;
  };
  reset();
  const pixels: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let cursor = 0;
  let previous: number[] | null = null;
  for (;;) {
    while (bitCount < codeWidth) {
      if (cursor >= data.length) return Uint8Array.from(pixels);
      bitBuffer |= data[cursor]! << bitCount;
      bitCount += 8;
      cursor += 1;
    }
    const code = bitBuffer & ((1 << codeWidth) - 1);
    bitBuffer >>= codeWidth;
    bitCount -= codeWidth;
    if (code === clear) { reset(); previous = null; continue; }
    if (code === end) break;
    let entry: number[];
    if (code < dictionary.length) entry = dictionary[code]!;
    else if (previous) entry = [...previous, previous[0]!];
    else throw new Error('bad code');
    pixels.push(...entry);
    if (previous) {
      dictionary.push([...previous, entry[0]!]);
      if (dictionary.length === (1 << codeWidth) && codeWidth < 12) codeWidth += 1;
    }
    previous = entry;
    if (pixels.length >= pixelCount) break;
  }
  return Uint8Array.from(pixels.slice(0, pixelCount));
}

function solid(width: number, height: number, red: number, green: number, blue: number, alpha = 255): GifFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = red; rgba[index * 4 + 1] = green; rgba[index * 4 + 2] = blue; rgba[index * 4 + 3] = alpha;
  }
  return { rgba };
}

/** Photo-like noise: a gradient plus grain, which is what makes LZW work hardest here. */
function noisy(width: number, height: number, seed: number): GifFrame {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const grain = ((x * 31 + y * 17 + seed * 53) % 23) - 11;
      rgba[index] = Math.max(0, Math.min(255, x * 255 / width + grain));
      rgba[index + 1] = Math.max(0, Math.min(255, y * 255 / height + grain));
      rgba[index + 2] = Math.max(0, Math.min(255, (x + y) * 127 / (width + height) + grain));
      rgba[index + 3] = 255;
    }
  }
  return { rgba };
}

describe('the GIF encoder (F23)', () => {
  it('writes a GIF89a with one palette, a forever loop and a frame delay', () => {
    const buffer = encodeGif([solid(4, 3, 255, 0, 0)], { width: 4, height: 3, delayCs: 50 });
    const gif = decodeGif(buffer);
    expect(gif).toMatchObject({ width: 4, height: 3, loop: 0, delayCs: 50 });
    expect(gif.frames).toHaveLength(1);
    expect(Buffer.from(gif.palette).equals(Buffer.from(colorTable()))).toBe(true);
    expect(buffer[buffer.length - 1]).toBe(0x3b);
  });

  it('round-trips pixels through its own palette', () => {
    const frames = [noisy(40, 30, 1), noisy(40, 30, 2), solid(40, 30, 10, 200, 90)];
    const gif = decodeGif(encodeGif(frames, { width: 40, height: 30, delayCs: 40 }));
    expect(gif.frames).toHaveLength(3);
    gif.frames.forEach((decoded, frameIndex) => {
      const source = frames[frameIndex]!.rgba;
      expect(decoded).toHaveLength(40 * 30);
      let worst = 0;
      for (let index = 0; index < decoded.length; index += 1) {
        const entry = decoded[index]!;
        expect(entry).toBe(paletteIndex(source[index * 4]!, source[index * 4 + 1]!, source[index * 4 + 2]!));
        worst = Math.max(worst, Math.abs(gif.palette[entry * 3]! - source[index * 4]!));
      }
      // 3-3-2 means at most 31 levels of red/green and 63 of blue of error, never more.
      expect(worst).toBeLessThanOrEqual(32);
    });
  });

  it('keeps a phone-sized loop small', () => {
    const frames = [noisy(GIF_MAX_EDGE_PX, 240, 3), noisy(GIF_MAX_EDGE_PX, 240, 4), noisy(GIF_MAX_EDGE_PX, 240, 5)];
    const buffer = encodeGif(frames, { width: GIF_MAX_EDGE_PX, height: 240, delayCs: 60 });
    // Three 320×240 photos must stay well under a megabyte; noise is the worst case for LZW.
    expect(buffer.length).toBeLessThan(400_000);
    expect(decodeGif(buffer).frames).toHaveLength(3);
  });

  it('survives a frame almost as large as the 4096-code table', () => {
    const frame = noisy(120, 120, 7);
    const gif = decodeGif(encodeGif([frame], { width: 120, height: 120, delayCs: 10 }));
    expect(gif.frames[0]).toHaveLength(120 * 120);
    const expected = paletteIndex(frame.rgba[0]!, frame.rgba[1]!, frame.rgba[2]!);
    expect(gif.frames[0]![0]).toBe(expected);
  });

  it('maps transparency to index 0 and refuses impossible input', () => {
    expect(paletteIndex(200, 100, 50, 0)).toBe(0);
    expect(() => encodeGif([], { width: 4, height: 4, delayCs: 10 })).toThrow(/at least one frame/);
    expect(() => encodeGif([solid(4, 3, 0, 0, 0)], { width: 4, height: 4, delayCs: 10 })).toThrow(/match the animation size/);
    expect(() => encodeGif([solid(4, 4, 0, 0, 0)], { width: 0, height: 4, delayCs: 10 })).toThrow(/Invalid GIF size/);
    expect(() => encodeGif([solid(4, 4, 0, 0, 0)], { width: 4, height: 4, delayCs: -1 })).toThrow(/frame delay/);
  });
});
