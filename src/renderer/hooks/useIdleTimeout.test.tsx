// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleTimeout } from './useIdleTimeout';

const TIMEOUT_MS = 5_000;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useIdleTimeout', () => {
  it('fires once the timeout elapses', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));
    act(() => { vi.advanceTimersByTime(TIMEOUT_MS - 1); });
    expect(onIdle).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: TIMEOUT_MS, enabled: false, onIdle }));
    act(() => { vi.advanceTimersByTime(TIMEOUT_MS * 3); });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('restarts the countdown on pointer and keyboard activity', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));
    act(() => { vi.advanceTimersByTime(4_000); });
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(onIdle).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(TIMEOUT_MS - 1); });
    expect(onIdle).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown when the caller reports activity', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }));
    act(() => { vi.advanceTimersByTime(4_000); });
    act(() => { result.current.resetActivity(); });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('uses the latest onIdle callback without rescheduling', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onIdle }) => useIdleTimeout({ timeoutMs: TIMEOUT_MS, enabled: true, onIdle }), { initialProps: { onIdle: first } });
    rerender({ onIdle: second });
    act(() => { vi.advanceTimersByTime(TIMEOUT_MS); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
