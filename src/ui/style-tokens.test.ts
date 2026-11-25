import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The booth's look lives in one place: the token block at the top of `style.css`. These checks are
 * the ones a colour change can break silently — a colour that leaks past the tokens, a token used
 * but never declared, and text that stops being readable on its surface.
 */
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

function rootBlock(): string {
  return /:root\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
}

function rootTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of rootBlock().matchAll(/(--[a-z-]+):(#[0-9a-fA-F]{3,8})/g)) tokens.set(match[1]!, match[2]!.toLowerCase());
  return tokens;
}

function luminance(hex: string): number {
  const digits = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255);
  const channel = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('booth theme tokens', () => {
  const tokens = rootTokens();

  it('declares every token the stylesheet uses', () => {
    const declared = new Set([...rootBlock().matchAll(/(--[a-z-]+):/g)].map((match) => match[1]!));
    // An event's brand colours are set on the root at runtime (`--event-primary`), so they are
    // never declared here; they always come with a fallback, which is what the second group is.
    const bare = [...css.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]!);
    expect([...new Set(bare)].filter((name) => !declared.has(name))).toEqual([]);
  });

  it('keeps colours out of the rules themselves', () => {
    const rules = css.replace(/:root\{[\s\S]*?\n\}/, '');
    expect([...rules.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0])).toEqual([]);
  });

  it('keeps every text token readable on every surface', () => {
    const surfaces = ['--page', '--card', '--inset'];
    const inks = ['--ink', '--ink-soft', '--ink-muted', '--ink-faint'];
    const failures: string[] = [];
    for (const ink of inks) {
      for (const surface of surfaces) {
        const ratio = contrast(tokens.get(ink)!, tokens.get(surface)!);
        if (ratio < 4.5) failures.push(`${ink} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps text readable on the accent and on the dark stage', () => {
    expect(contrast(tokens.get('--on-accent')!, tokens.get('--accent')!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.get('--on-stage')!, tokens.get('--stage')!)).toBeGreaterThanOrEqual(4.5);
    // The stage is a photo well, not a surface: it stays dark in a light theme, and the page ink
    // must not be used on it.
    expect(luminance(tokens.get('--stage')!)).toBeLessThan(0.1);
    expect(luminance(tokens.get('--page')!)).toBeGreaterThan(0.8);
  });

  it('keeps the lines visible but quiet', () => {
    const ratio = contrast(tokens.get('--line')!, tokens.get('--card')!);
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(2.5);
  });
});
