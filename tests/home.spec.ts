import { expect, test } from '@playwright/test';

test('camera setup screen loads without requiring a physical camera', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /frame the moment/i })).toBeVisible();
  await expect(page.getByLabel('COUNTDOWN')).toHaveValue('3');
  await expect(page.getByRole('button', { name: /start countdown/i })).toBeDisabled();
});
