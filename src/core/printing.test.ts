import { describe, expect, it } from 'vitest';
import { decideAutoPrint } from './printing';

describe('auto print decision', () => {
  it('prints on completion when the event allows printing and a printer is chosen', () => {
    expect(decideAutoPrint({ printEnabled: true }, 'DNP DS-RX1')).toEqual({ shouldPrint: true, status: '' });
  });

  it('respects the per-event printing switch', () => {
    expect(decideAutoPrint({ printEnabled: false }, 'DNP DS-RX1')).toEqual({
      shouldPrint: false,
      status: 'Printing is turned off for this event.',
    });
  });

  it('reports a missing printer instead of sending a job', () => {
    expect(decideAutoPrint({ printEnabled: true }, '')).toEqual({
      shouldPrint: false,
      status: 'No printer selected. Choose one, then print.',
    });
  });

  it('prefers the event switch when both reasons apply', () => {
    expect(decideAutoPrint({ printEnabled: false }, '').status).toBe('Printing is turned off for this event.');
  });
});
