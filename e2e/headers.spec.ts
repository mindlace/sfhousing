import { expect, test } from '@playwright/test';

test('home page sends CSP and referrer policy with no CSP violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('Content Security Policy')) violations.push(m.text());
  });
  const res = await page.goto('/');
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(res?.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(violations).toEqual([]);
});
