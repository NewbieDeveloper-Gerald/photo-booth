import { expect, test } from '@playwright/test';

test('placeholder home screen loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /your booth/i })).toBeVisible();
  await expect(page.getByText('Booth is ready')).toBeVisible();
});
