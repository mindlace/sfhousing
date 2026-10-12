import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const source = {
  id: 'datasf-parcels',
  url: 'https://data.sfgov.org/x',
  retrievedAt: '2026-10-01T00:00:00Z',
  license: 'PDDL'
};
const manifest = {
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-09T12:00:00Z',
  sources: [source]
};

async function expectNotices() {
  await expect.element(page.getByText('Map data ©')).toBeInTheDocument();
  await expect
    .element(page.getByRole('link', { name: 'OpenStreetMap contributors' }))
    .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect.element(page.getByText('Buildings © Overture Maps Foundation;')).toBeInTheDocument();
  await expect.element(page.getByText('Basemap by Protomaps (protomaps.com)')).toBeInTheDocument();
  await expect
    .element(page.getByText('Parcels, land use, building footprints'))
    .toBeInTheDocument();
  await expect.element(page.getByText('made available under the ODbL 1.0.')).toBeInTheDocument();
  await expect.element(page.getByRole('heading', { name: 'Software' })).toBeInTheDocument();
  await expect.element(page.getByRole('link', { name: 'MapLibre GL JS' })).toBeInTheDocument();
  await expect
    .element(page.getByRole('link', { name: 'luma.gl', exact: true }))
    .toHaveAttribute('href', 'https://luma.gl');
  await expect
    .element(page.getByRole('link', { name: 'MIT licensed' }))
    .toHaveAttribute('href', expect.stringMatching(/\/blob\/main\/LICENSE$/));
}

describe('/attribution page', () => {
  it('renders the manifest table and notices', async () => {
    render(Page, { data: { datasetVersion: 'fixture-0', appRelease: 'dev', manifest } });
    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('Data & licences');
    await expect
      .element(page.getByText('Dataset version fixture-0, built 2026-10-09.'))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('link', { name: 'datasf-parcels' }))
      .toHaveAttribute('href', 'https://data.sfgov.org/x');
    await expect.element(page.getByRole('cell', { name: 'PDDL' })).toBeInTheDocument();
    await expect.element(page.getByRole('cell', { name: '2026-10-01' })).toBeInTheDocument();
    await expectNotices();
  });

  it('uses the label as link text when present', async () => {
    render(Page, {
      data: {
        datasetVersion: 'fixture-0',
        appRelease: 'dev',
        manifest: { ...manifest, sources: [{ ...source, label: 'Parcels' }] }
      }
    });
    await expect
      .element(page.getByRole('link', { name: 'Parcels', exact: true }))
      .toBeInTheDocument();
  });

  it('shows a fallback and no table without a manifest', async () => {
    render(Page, { data: { datasetVersion: 'fixture-0', appRelease: 'dev', manifest: null } });
    await expect
      .element(page.getByText('Source list unavailable for this dataset version.'))
      .toBeInTheDocument();
    await expect.element(page.getByText('Dataset version fixture-0.')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    await expectNotices();
  });
});
