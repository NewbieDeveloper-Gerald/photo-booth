import { describe, expect, it } from 'vitest';
import { layoutPresets } from '../../features/layouts';
import { boothLayoutChoices } from './offered-layouts';

function templates(): Array<{ id: string; name: string; shots: number; copies: number; pagePreset: '4x6'; pageLabel: string; builtIn: boolean }> {
  return layoutPresets.slice(0, 3).map((preset) => ({ id: preset.id, name: preset.name, shots: preset.shots, copies: preset.copies, pagePreset: '4x6' as const, pageLabel: '4 × 6 in', builtIn: true }));
}

describe('boothLayoutChoices (F13)', () => {
  it('lists the offered layouts in the operator’s order', () => {
    const all = templates();
    const choices = boothLayoutChoices({ offeredLayoutIds: [all[2]!.id, all[0]!.id], defaultLayoutId: all[0]!.id }, all);
    expect(choices.map((choice) => choice.id)).toEqual([all[2]!.id, all[0]!.id]);
  });

  it('skips layouts that no longer exist', () => {
    const all = templates();
    expect(boothLayoutChoices({ offeredLayoutIds: ['deleted-layout', all[1]!.id], defaultLayoutId: all[1]!.id }, all).map((choice) => choice.id)).toEqual([all[1]!.id]);
  });

  it('falls back to the default layout when nothing offered exists any more', () => {
    const all = templates();
    expect(boothLayoutChoices({ offeredLayoutIds: ['gone'], defaultLayoutId: all[1]!.id }, all).map((choice) => choice.id)).toEqual([all[1]!.id]);
  });

  it('never returns an empty picker while templates exist', () => {
    const all = templates();
    expect(boothLayoutChoices({ offeredLayoutIds: [], defaultLayoutId: 'missing' }, all).map((choice) => choice.id)).toEqual([all[0]!.id]);
    expect(boothLayoutChoices({ offeredLayoutIds: [], defaultLayoutId: 'missing' }, [])).toEqual([]);
  });
});
