import { expect, test } from '@playwright/test';

test('session screen loads without requiring a physical camera', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /frame the moment/i })).toBeVisible();
  await expect(page.getByText('Default Event')).toBeVisible();
  await expect(page.getByLabel('COUNTDOWN')).toHaveValue('3');
  await expect(page.getByLabel('RETAKES PER SESSION')).toHaveValue('3');
  await expect(page.getByRole('button', { name: /start session/i })).toBeDisabled();
});
