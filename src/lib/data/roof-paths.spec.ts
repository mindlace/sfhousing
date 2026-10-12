import { expect, it } from 'vitest';
import { roofArtifactUrls } from './roof-paths';
const descriptor = {
  schemaVersion: 1,
  indexUrl: '/data/fixture-0/roofs/index.json',
  auditUrl: '/data/fixture-0/roofs/audit.json',
  reportUrl: '/data/fixture-0/roofs/report.json'
};
it('retains future schema top-level URLs without interpreting their index', () => {
  expect(
    roofArtifactUrls({ ...descriptor, schemaVersion: 9 }, { untrusted: 'layout' } as never)
  ).toEqual([descriptor.indexUrl, descriptor.auditUrl, descriptor.reportUrl]);
});
it.each([
  '/data/fixture-9/roofs/audit.json',
  '/data/fixture-0/roofs/%2e%2e/x',
  '/data/fixture-0/../x',
  'https://other.test/x'
])('rejects unsafe top-level URL %s before use', (auditUrl) => {
  expect(() => roofArtifactUrls({ ...descriptor, auditUrl }, undefined)).toThrow();
});
