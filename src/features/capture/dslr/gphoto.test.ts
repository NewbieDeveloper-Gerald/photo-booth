import { describe, expect, it } from 'vitest';
import {
  autoDetectArgs, capturePreviewArgs, captureStillArgs, describeGphotoFailure, describeHelperFailure,
  extractJpeg, isPromisedModel, parseDetectedCameras,
} from './gphoto';

const jpeg = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);

describe('gphoto2 helper commands (F26)', () => {
  it('asks for the camera, one preview frame, and a still on stdout', () => {
    expect(autoDetectArgs()).toEqual(['--auto-detect']);
    expect(capturePreviewArgs()).toEqual(['--capture-preview', '--stdout']);
    expect(captureStillArgs()).toEqual(['--capture-image-and-download', '--stdout']);
  });

  it('reads the camera list out of the helper table, ignoring header and rule', () => {
    const stdout = [
      'Model                          Port',
      '----------------------------------------------------------',
      'Canon EOS 250D                 usb:001,004',
      '',
      'Canon EOS 700D                 usb:001,005',
      '',
    ].join('\n');
    expect(parseDetectedCameras(stdout)).toEqual(['Canon EOS 250D', 'Canon EOS 700D']);
    expect(parseDetectedCameras('Model Port\n----------------\n')).toEqual([]);
    expect(parseDetectedCameras('')).toEqual([]);
  });

  it('knows when the promised model is the one that answered', () => {
    expect(isPromisedModel(['Canon EOS 250D'])).toBe(true);
    expect(isPromisedModel(['canon eos 250d'])).toBe(true);
    expect(isPromisedModel(['Nikon D5600'])).toBe(false);
  });

  it('cuts the JPEG out of the helper chatter around it', () => {
    const stdout = jpeg(0x2a, 0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9, 0x00, 0xff, 0xd9);
    expect(Array.from(extractJpeg(stdout))).toEqual([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    expect(() => extractJpeg(jpeg(1, 2, 3))).toThrow('The camera did not return a photo');
    expect(() => extractJpeg(jpeg(0xff, 0xd8, 1, 2))).toThrow('The camera did not return a photo');
  });

  it('says what to do when the helper is missing, hung or failed', () => {
    expect(describeHelperFailure(Object.assign(new Error('spawn gphoto2 ENOENT'), { code: 'ENOENT' })))
      .toContain('is not installed');
    expect(describeHelperFailure(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
      .toContain('stopped answering');
    expect(describeHelperFailure(new Error('weird'))).toContain('failed');
  });

  it('turns gphoto2 stderr into an operator sentence', () => {
    expect(describeGphotoFailure('*** Error ***\nCould not find any camera!', 1)).toContain('No tether camera was found');
    expect(describeGphotoFailure('Could not claim the USB device', 1)).toContain('is busy');
    expect(describeGphotoFailure('Access is denied', 1)).toContain('Windows refused access');
    expect(describeGphotoFailure('Battery level critical', 1)).toContain('low power');
    expect(describeGphotoFailure('Something odd happened here\nsecond line', 3)).toBe('The camera reported: Something odd happened here');
    expect(describeGphotoFailure('', 4)).toBe('The camera command failed (exit code 4).');
  });
});
