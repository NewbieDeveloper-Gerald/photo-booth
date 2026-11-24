import { describe, expect, it } from 'vitest';
import {
  ANIMATION_MAX_EDGE_PX, MAX_ANIMATION_BYTES, boomerangOrder, fitWithinSize, framesForBudget, isAnimatedOutput,
  pickBurstFrames, wantsBoomerang, wantsSlideshow,
} from './animation-plan';

describe('the animation plan (F23)', () => {
  it('knows which extra an event asks for', () => {
    expect([wantsSlideshow('none'), wantsBoomerang('none')]).toEqual([false, false]);
    expect([wantsSlideshow('gif'), wantsBoomerang('gif')]).toEqual([true, false]);
    expect([wantsSlideshow('boomerang'), wantsBoomerang('boomerang')]).toEqual([false, true]);
    expect([wantsSlideshow('both'), wantsBoomerang('both')]).toEqual([true, true]);
    expect(isAnimatedOutput('gif')).toBe(true);
    expect(isAnimatedOutput('video')).toBe(false);
    expect(isAnimatedOutput(null)).toBe(false);
  });

  it('plays a boomerang forward and straight back without repeating the ends', () => {
    expect(boomerangOrder(3)).toEqual([0, 1, 2, 1]);
    expect(boomerangOrder(4)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(boomerangOrder(1)).toEqual([0]);
    expect(boomerangOrder(0)).toEqual([]);
  });

  it('spreads a long burst over the six frames a phone can carry', () => {
    expect(pickBurstFrames(4)).toEqual([0, 1, 2, 3]);
    expect(pickBurstFrames(12)).toHaveLength(6);
    expect(pickBurstFrames(12)[0]).toBe(0);
    expect(pickBurstFrames(12).at(-1)).toBe(11);
    expect(new Set(pickBurstFrames(12)).size).toBe(6);
    expect(pickBurstFrames(12).every((index, position, list) => position === 0 || index > list[position - 1]!)).toBe(true);
  });

  it('scales a frame down to the animation size without stretching it', () => {
    expect(fitWithinSize(2048, 1536)).toEqual({ width: ANIMATION_MAX_EDGE_PX, height: 240 });
    expect(fitWithinSize(600, 1800)).toEqual({ width: 107, height: ANIMATION_MAX_EDGE_PX });
    expect(fitWithinSize(200, 150)).toEqual({ width: 200, height: 150 });
    expect(() => fitWithinSize(0, 10)).toThrow(/Invalid animation frame size/);
  });

  it('drops frames when a loop came out heavier than a phone should download', () => {
    expect(framesForBudget(4, null)).toEqual([0, 1, 2, 3]);
    expect(framesForBudget(4, MAX_ANIMATION_BYTES)).toEqual([0, 1, 2, 3]);
    const reduced = framesForBudget(8, MAX_ANIMATION_BYTES * 2);
    expect(reduced.length).toBeLessThan(8);
    expect(reduced.length).toBeGreaterThanOrEqual(1);
    expect(framesForBudget(1, MAX_ANIMATION_BYTES * 10)).toEqual([0]);
    expect(framesForBudget(3, MAX_ANIMATION_BYTES * 2)).toHaveLength(1);
  });
});
