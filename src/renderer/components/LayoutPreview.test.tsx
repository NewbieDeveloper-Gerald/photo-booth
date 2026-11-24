// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGridTemplate, templateFromCatalogPreset, layoutPresets } from '../../features/layouts';
import { LayoutPreview } from './LayoutPreview';

describe('LayoutPreview (F13)', () => {
  it('draws one placeholder per photo slot', () => {
    const { container } = render(<LayoutPreview document={createGridTemplate({ pageId: '4x6', shots: 4 })} label="Four photos" />);
    expect(container.querySelectorAll('svg [data-slot]')).toHaveLength(4);
  });

  it('uses the print geometry so the preview matches the printed page', () => {
    const document = templateFromCatalogPreset(layoutPresets[0]!);
    const { container } = render(<LayoutPreview document={document} label={document.name} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(`0 0 ${document.page.widthPx} ${document.page.heightPx}`);
  });

  it('is announced to screen readers with the layout name', () => {
    const document = templateFromCatalogPreset(layoutPresets[0]!);
    render(<LayoutPreview document={document} label={document.name} />);
    expect(screen.getByRole('img', { name: `${document.name} preview` })).toBeDefined();
  });
});
