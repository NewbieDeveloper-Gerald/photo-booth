import { describe, expect, it } from 'vitest';
import { cameraErrorMessage } from './camera-messages';

function named(name: string): Error {
  const error = new Error('boom');
  error.name = name;
  return error;
}

describe('camera error messages', () => {
  it('explains permission problems', () => {
    expect(cameraErrorMessage(named('NotAllowedError'))).toMatch(/permission/i);
    expect(cameraErrorMessage(named('SecurityError'))).toMatch(/permission/i);
  });
  it('explains a camera that does not match the request', () => {
    expect(cameraErrorMessage(named('NotFoundError'))).toMatch(/no camera matched/i);
    expect(cameraErrorMessage(named('OverconstrainedError'))).toMatch(/no camera matched/i);
  });
  it('explains a busy or unplugged camera', () => {
    expect(cameraErrorMessage(named('NotReadableError'))).toMatch(/another app/i);
    expect(cameraErrorMessage(named('AbortError'))).toMatch(/another app/i);
  });
  it('falls back to a generic message for unknown values', () => {
    expect(cameraErrorMessage('nope')).toMatch(/could not start/i);
    expect(cameraErrorMessage(new Error('other'))).toMatch(/could not start/i);
  });
});
