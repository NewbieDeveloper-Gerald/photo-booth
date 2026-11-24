// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsCard } from './AnalyticsCard';

describe('AnalyticsCard (F24)', () => {
  it('points at the booth address when no public URL is configured', () => {
    render(<AnalyticsCard downloadBaseUrl="" />);
    const link = screen.getByLabelText('Dashboard link') as HTMLInputElement;
    expect(link.value).toBe('http://127.0.0.1:47625/admin');
    expect(link.readOnly).toBe(true);
    expect(screen.getByLabelText('Booth numbers').textContent).toContain('address on the booth computer');
    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveProperty('href', 'http://127.0.0.1:47625/admin');
  });

  it('uses the tunnel the guest links already use, and drops a trailing slash', () => {
    render(<AnalyticsCard downloadBaseUrl="https://photos.example.com/" />);
    expect((screen.getByLabelText('Dashboard link') as HTMLInputElement).value).toBe('https://photos.example.com/admin');
    expect(screen.getByLabelText('Booth numbers').textContent).not.toContain('address on the booth computer');
  });

  it('says what the page shows and how to sign in', () => {
    render(<AnalyticsCard downloadBaseUrl="https://photos.example.com" />);
    const text = screen.getByLabelText('Booth numbers').textContent ?? '';
    expect(text).toContain('Sessions, photos, retakes, prints and downloads per event');
    expect(text).toContain('sign in with the admin PIN');
    expect(text).toContain('CSV');
  });
});
