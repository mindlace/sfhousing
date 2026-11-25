import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PASSKEY_RP_NAME, PRODUCT_NAME } from '$lib/server/auth/brand';
import { SITE_NAME } from './name';

it("the site's name is SF Housing, and the mails and the passkey prompt say it", () => {
  expect(SITE_NAME).toBe('SF Housing');
  expect(PRODUCT_NAME).toBe(SITE_NAME);
  expect(PASSKEY_RP_NAME).toBe(SITE_NAME);
});

it('SES_FROM names SF Housing in production and staging', () => {
  const text = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
  const froms = [...text.matchAll(/"SES_FROM":\s*"([^"]*)"/g)].map((m) => m[1]);
  expect(froms).toEqual([
    'SF Housing <noreply@sfhousing.mindlace.net>',
    'SF Housing <noreply@sfhousing.mindlace.net>'
  ]);
});
