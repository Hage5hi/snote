import { test } from '@playwright/test';
test('inspect', async ({ page }) => {
  await page.addInitScript(()=>{localStorage.setItem('lang','en');localStorage.setItem('lang.ip_detected','1');});
  await page.goto('/');
  await page.waitForSelector('[data-testid="install-prompt"]');
  const out = await page.locator('[data-testid="install-prompt"]').evaluate(el => {
    return Array.from(el.children).map(c => ({tag: c.tagName, html: c.outerHTML.slice(0,150)}));
  });
  console.log('CHILDREN', JSON.stringify(out, null, 2));
});
