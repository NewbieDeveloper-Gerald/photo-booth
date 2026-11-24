import { describe, expect, it } from 'vitest';
import { isHexColor } from './validation/colors';
import { isEventId, isRecordId, isSessionId, isShareToken } from './validation/identifiers';
import { isInsidePath, isOverlappingPath } from './validation/paths';
import { isBoothSettingKey } from './constants/settings-keys';
import { toErrorMessage } from './errors';

describe('shared validation', () => {
  it('accepts only supported booth setting keys', () => {
    expect(isBoothSettingKey('selectedPrinterName')).toBe(true);
    expect(isBoothSettingKey('adminPinHash')).toBe(false);
    expect(isBoothSettingKey(42)).toBe(false);
  });

  it('recognises session, event, photo and share-token identifiers', () => {
    expect(isSessionId('9f6b1b6e-0f2b-4a3e-9f8e-2f0a1b2c3d4e')).toBe(true);
    expect(isRecordId('not-a-uuid')).toBe(false);
    expect(isEventId('default-event')).toBe(true);
    expect(isEventId('has space')).toBe(false);
    expect(isShareToken('a'.repeat(22))).toBe(true);
    expect(isShareToken('a'.repeat(21))).toBe(false);
  });

  it('treats inside and overlapping paths correctly for both separators', () => {
    expect(isInsidePath('/booth/photos', '/booth/photos/event/1.jpg')).toBe(true);
    expect(isInsidePath('/booth/photos', '/booth/photosx/1.jpg')).toBe(false);
    expect(isInsidePath('C:\\booth\\photos', 'C:\\booth\\photos\\1.jpg', '\\')).toBe(true);
    expect(isOverlappingPath('/booth/photos', '/booth/photos/event')).toBe(true);
    expect(isOverlappingPath('/booth/photos', '/booth/backup')).toBe(false);
  });

  it('accepts six-digit hex colours only', () => {
    expect(isHexColor('#c90000')).toBe(true);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#c9000')).toBe(false);
  });

  it('normalises thrown values for operator messages', () => {
    expect(toErrorMessage(new Error('Disk full'), 'fallback')).toBe('Disk full');
    expect(toErrorMessage('nope', 'fallback')).toBe('fallback');
    expect(toErrorMessage(new Error(''), 'fallback')).toBe('fallback');
  });
});
