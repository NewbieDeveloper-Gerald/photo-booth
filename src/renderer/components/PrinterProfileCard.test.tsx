// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrinterProfileCard } from './PrinterProfileCard';
import type { PrinterProfile } from '../../features/printing/index';

const profile = (overrides: Partial<PrinterProfile> = {}): PrinterProfile => ({
  id: '11111111-1111-4111-8111-111111111111', name: 'Front counter', modelId: 'dnp-qw410', printerName: 'DNP QW410',
  paperId: '4x6', cutMode: 'per-print', colorMode: 'color', brightness: 0, contrast: 0, saturation: 0,
  isDefault: true, verifiedAt: null, createdAt: '2026-11-24 09:00:00', updatedAt: '2026-11-24 09:00:00', ...overrides,
});

const printers = [{ name: 'DNP QW410', displayName: 'DNP QW410' }, { name: 'SELPHY CP1500', displayName: 'Canon Selphy' }];

type CardProps = React.ComponentProps<typeof PrinterProfileCard>;

function renderCard(overrides: Partial<CardProps> = {}): CardProps {
  const props: CardProps = {
    profiles: [profile()], printers, busy: false,
    onSave: vi.fn<CardProps['onSave']>(async () => undefined),
    onDelete: vi.fn<CardProps['onDelete']>(async () => undefined),
    onChecked: vi.fn<CardProps['onChecked']>(async () => undefined),
    onTestPrint: vi.fn<CardProps['onTestPrint']>(async () => 'Test sheet sent.'),
    ...overrides,
  };
  render(<PrinterProfileCard {...props} />);
  return props;
}

/** The spies were built with vi.fn, so the assertions can read their calls back. */
const calls = (fn: unknown): unknown[][] => (fn as { mock: { calls: unknown[][] } }).mock.calls;

describe('PrinterProfileCard (F25)', () => {
  it('shows what each saved profile sets and whether it was checked on the printer', () => {
    renderCard({ profiles: [profile(), profile({ id: '22222222-2222-4222-8222-222222222222', name: 'Selphy', modelId: 'canon-selphy-cp1500', printerName: '', paperId: '4x6', cutMode: 'per-job', isDefault: false, verifiedAt: '2026-11-24 10:20:00' })] });
    const text = screen.getByLabelText('Printer profiles').textContent ?? '';
    expect(text).toContain('Front counter · default');
    expect(text).toContain('DNP QW410 · 4 × 6 in · Cut after every print · Colour');
    expect(text).toContain('Prints to DNP QW410');
    expect(text).toContain('Not checked on this printer yet');
    expect(text).toContain('Prints to Any printer (booth default)');
    expect(text).toContain('Test print checked on 2026-11-24');
  });

  it('saves a new profile with the paper sizes of the model it names', async () => {
    const props = renderCard({ profiles: [] });
    expect(screen.getByLabelText('Printer profiles').textContent).toContain('No printer profile yet');
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Night shift' } });
    fireEvent.change(screen.getByLabelText('Printer model'), { target: { value: 'dnp-ds-rx1hs' } });
    fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: '6x8' } });
    fireEvent.change(screen.getByLabelText('Profile printer'), { target: { value: 'SELPHY CP1500' } });
    fireEvent.change(screen.getByLabelText('Brightness percent'), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(calls(props.onSave)[0]![0]).toMatchObject({ name: 'Night shift', modelId: 'dnp-ds-rx1hs', paperId: '6x8', printerName: 'SELPHY CP1500', brightness: -10 });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Printer profile saved.'));
  });

  it('only offers the cut modes the chosen model can do', () => {
    renderCard({ profiles: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    fireEvent.change(screen.getByLabelText('Printer model'), { target: { value: 'canon-selphy-cp1500' } });
    const options = Array.from((screen.getByLabelText('Cut mode') as HTMLSelectElement).options).map((option) => option.textContent);
    expect(options).toEqual(['Cut once at the end of the job', 'No cut, trim by hand']);
  });

  it('prints the test sheet and then records the tick', async () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Print test sheet' }));
    await waitFor(() => expect(props.onTestPrint).toHaveBeenCalledWith(expect.objectContaining({ id: profile().id })));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Test sheet sent.'));

    fireEvent.click(screen.getByRole('button', { name: 'It printed correctly' }));
    await waitFor(() => expect(props.onChecked).toHaveBeenCalledWith(profile().id, true));
  });

  it('clears a tick once the sheet is no longer trusted', async () => {
    const checked = profile({ verifiedAt: '2026-11-24 10:20:00' });
    const props = renderCard({ profiles: [checked] });
    fireEvent.click(screen.getByRole('button', { name: 'Clear tick' }));
    await waitFor(() => expect(props.onChecked).toHaveBeenCalledWith(checked.id, false));
  });

  it('reports a refused save instead of pretending it worked', async () => {
    const failing = renderCard({ onSave: vi.fn<CardProps['onSave']>(async () => { throw new Error('That printer already has a profile ("Front counter").'); }) });
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }));
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(failing.onSave).toHaveBeenCalled());
    expect(screen.getByRole('alert').textContent).toContain('already has a profile');
  });

  it('cannot send a test sheet when there is nothing to send it to', () => {
    renderCard({ printers: [], profiles: [profile({ printerName: '' })] });
    expect((screen.getByRole('button', { name: 'Print test sheet' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
