import React, { useMemo, useState } from 'react';
import {
  CUT_MODE_LABELS, MAX_COLOR_ADJUSTMENT_PERCENT, PRINTER_MODELS, describeProfile, findPrinterModel,
  verificationLabel, type PrinterProfile, type PrinterProfileDraft,
} from '../../features/printing/index';

export type PrinterChoice = { name: string; displayName: string };

type PrinterProfileCardProps = {
  profiles: PrinterProfile[];
  printers: PrinterChoice[];
  busy?: boolean;
  /** Saves a draft; the panel re-reads the list afterwards so ids and ticks stay in step. */
  onSave: (draft: PrinterProfileDraft) => Promise<void>;
  onDelete: (profileId: string) => Promise<void>;
  onChecked: (profileId: string, checked: boolean) => Promise<void>;
  /** Prints the profile's test sheet and resolves with a message for the operator. */
  onTestPrint: (profile: PrinterProfile) => Promise<string>;
};

type Draft = PrinterProfileDraft;

const emptyDraft = (): Draft => ({
  name: '', modelId: PRINTER_MODELS[0]!.id, printerName: '', paperId: PRINTER_MODELS[0]!.paperSizes[0]!.id,
  cutMode: 'per-print', colorMode: 'color', brightness: 0, contrast: 0, saturation: 0, isDefault: false,
});

const draftFrom = (profile: PrinterProfile): Draft => ({
  id: profile.id, name: profile.name, modelId: profile.modelId, printerName: profile.printerName,
  paperId: profile.paperId, cutMode: profile.cutMode, colorMode: profile.colorMode,
  brightness: profile.brightness, contrast: profile.contrast, saturation: profile.saturation, isDefault: profile.isDefault,
});

const ADJUSTMENTS: Array<{ key: 'brightness' | 'contrast' | 'saturation'; label: string }> = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
];

/**
 * Saved printer profiles (F25): one printer model, one paper size, one cut mode and the colour
 * settings, kept per printer so the booth prints the same way every morning. Each profile carries
 * its own test print, because a sheet size or a cut mode is only true once it has come out of the
 * real printer.
 */
export function PrinterProfileCard({
  profiles, printers, busy = false, onSave, onDelete, onChecked, onTestPrint,
}: PrinterProfileCardProps): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const model = useMemo(() => (draft ? findPrinterModel(draft.modelId) : undefined), [draft]);
  const printerLabel = (name: string): string => {
    if (!name) return 'Any printer (booth default)';
    return printers.find((printer) => printer.name === name)?.displayName || name;
  };

  const run = async (action: () => Promise<void>, message: string): Promise<void> => {
    setError('');
    setNote('');
    try { await action(); setNote(message); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the printer profile.'); }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await run(async () => { await onSave(draft); setDraft(null); }, 'Printer profile saved.');
    } finally { setSaving(false); }
  };

  const testSheet = async (profile: PrinterProfile): Promise<void> => {
    setError('');
    setNote('');
    try { setNote(await onTestPrint(profile)); } catch (caught) { setError(caught instanceof Error ? caught.message : 'The test sheet could not be printed.'); }
  };

  return (
    <section className="recovery-card profile-card" aria-label="Printer profiles">
      <div className="profile-heading">
        <div>
          <p className="eyebrow">PRINTER PROFILES</p>
          <strong>{profiles.length ? `${profiles.length} saved` : 'No printer profile yet'}</strong>
        </div>
        {!draft && <button type="button" className="secondary-button" onClick={() => { setDraft(emptyDraft()); setNote(''); setError(''); }} disabled={busy}>
          Add profile
        </button>}
      </div>

      <p className="queue-note">
        A profile sets the paper size, cut mode and colour for one printer model, so a 6 × 8 sheet
        is not squeezed into a 4 × 6 layout. Print the test sheet once per printer: the tick then
        says this model was really checked on that hardware.
      </p>

      {profiles.length > 0 && <ul className="profile-list">
        {profiles.map((profile) => (
          <li key={profile.id} className="profile-row">
            <div>
              <strong>{profile.name}{profile.isDefault ? ' · default' : ''}</strong>
              <span>{describeProfile(profile)}</span>
              <span>Prints to {printerLabel(profile.printerName)}</span>
              <span className={profile.verifiedAt ? 'profile-checked' : 'profile-unchecked'}>{verificationLabel(profile)}</span>
            </div>
            <div className="profile-actions">
              <button type="button" className="secondary-button" onClick={() => { setDraft(draftFrom(profile)); setNote(''); setError(''); }} disabled={busy}>Edit</button>
              <button type="button" className="secondary-button" onClick={() => void testSheet(profile)} disabled={busy || !profile.printerName && printers.length === 0}>Print test sheet</button>
              <button type="button" className="secondary-button" onClick={() => void run(() => onChecked(profile.id, profile.verifiedAt === null), profile.verifiedAt ? 'Test print unchecked.' : 'Test print marked as checked.')} disabled={busy}>
                {profile.verifiedAt ? 'Clear tick' : 'It printed correctly'}
              </button>
              <button type="button" className="secondary-button" onClick={() => void run(() => onDelete(profile.id), 'Printer profile deleted.')} disabled={busy}>Delete</button>
            </div>
          </li>
        ))}
      </ul>}

      {draft && <form className="profile-form" onSubmit={(event) => void submit(event)}>
        <label>Profile name<input aria-label="Profile name" maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Printer model<select aria-label="Printer model" value={draft.modelId} onChange={(event) => {
          const next = findPrinterModel(event.target.value);
          setDraft({ ...draft, modelId: event.target.value, paperId: next?.paperSizes[0]?.id ?? draft.paperId, cutMode: next?.cutModes[0] ?? draft.cutMode });
        }}>{PRINTER_MODELS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        <label>Paper size<select aria-label="Paper size" value={draft.paperId} onChange={(event) => setDraft({ ...draft, paperId: event.target.value })}>
          {(model?.paperSizes ?? []).map((paper) => <option key={paper.id} value={paper.id}>{paper.label}</option>)}
        </select></label>
        <label>Cut mode<select aria-label="Cut mode" value={draft.cutMode} onChange={(event) => setDraft({ ...draft, cutMode: event.target.value as Draft['cutMode'] })}>
          {(model?.cutModes ?? []).map((mode) => <option key={mode} value={mode}>{CUT_MODE_LABELS[mode]}</option>)}
        </select></label>
        <label>Colour<select aria-label="Colour mode" value={draft.colorMode} onChange={(event) => setDraft({ ...draft, colorMode: event.target.value as Draft['colorMode'] })}>
          <option value="color">Colour</option>
          <option value="mono">Black and white</option>
        </select></label>
        <label>Printer<select aria-label="Profile printer" value={draft.printerName} onChange={(event) => setDraft({ ...draft, printerName: event.target.value })}>
          <option value="">Any printer (booth default)</option>
          {printers.map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}</option>)}
        </select></label>
        {ADJUSTMENTS.map(({ key, label }) => (
          <label key={key}>{label} %<input aria-label={`${label} percent`} type="number" min={-MAX_COLOR_ADJUSTMENT_PERCENT} max={MAX_COLOR_ADJUSTMENT_PERCENT} step={1}
            value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} /></label>
        ))}
        <label className="attract-toggle"><input aria-label="Use as the booth default" type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} /> <span>Use as the booth default profile</span></label>
        {model && <p className="queue-note">{model.notes}</p>}
        <div className="profile-actions">
          <button type="submit" className="start-button" disabled={busy || saving}>Save profile</button>
          <button type="button" className="secondary-button" onClick={() => { setDraft(null); setError(''); }} disabled={saving}>Cancel</button>
        </div>
      </form>}

      {note && <p className="profile-note" role="status">{note}</p>}
      {error && <p className="pin-error" role="alert">{error}</p>}
    </section>
  );
}
