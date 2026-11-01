/// <reference types="@vitest/browser-playwright" />
// "Protections" (plan 3, Task 10; sim runs: category-only): the category checkboxes, the years
// input of "newer than" and the note. The protect brush is gone.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import ProtectionsSection from './ProtectionsSection.svelte';
import { DEFAULT_POLICY } from './policy';
import { PolicyStore } from './policy-store.svelte';

function setup() {
  const store = new PolicyStore(DEFAULT_POLICY);
  const announce = vi.fn();
  render(ProtectionsSection, { props: { store, announce } });
  return { store, announce };
}

describe('ProtectionsSection', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });

  it('starts from the policy: no category checked, years 30 and disabled', async () => {
    setup();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }))
      .not.toBeChecked();
    await expect
      .element(page.getByRole('checkbox', { name: 'Buildings newer than' }))
      .not.toBeChecked();
    const years = page.getByRole('spinbutton', { name: /years/i });
    await expect.element(years).toBeDisabled();
    await expect.element(years).toHaveValue(30);
    // A real disabled attribute, explained by the checkbox above it.
    expect((years.element() as HTMLInputElement).disabled).toBe(true);
    await expect
      .element(
        page.getByText(
          'Protected lots get no new housing in the simulation. Projects already in the pipeline continue.'
        )
      )
      .toBeVisible();
  });

  it('each checkbox sets its field, as one undoable change', async () => {
    const { store, announce } = setup();
    await page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }).click();
    expect(store.policy.protect.rentControl).toBe(true);
    expect(store.undoLabel).not.toBeNull();
    expect(announce).toHaveBeenCalledWith(store.undoLabel);
    await page.getByRole('checkbox', { name: 'Historic buildings (status A or A*)' }).click();
    expect(store.policy.protect.historic).toBe(true);
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    expect(store.policy.protect.newerThanYears).toBe(30);
    await expect.element(page.getByRole('spinbutton', { name: /years/i })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    expect(store.policy.protect.newerThanYears).toBeNull();
    await expect.element(page.getByRole('spinbutton', { name: /years/i })).toBeDisabled();
    // Undo restores the checkbox state from the store.
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Buildings newer than' }))
      .toBeChecked();
    store.undo();
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .toBeChecked();
    store.undo();
    await expect
      .element(page.getByRole('checkbox', { name: 'Rent-controlled buildings (likely)' }))
      .not.toBeChecked();
  });

  it('a valid year count sets newerThanYears', async () => {
    const { store } = setup();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    const years = page.getByRole('spinbutton', { name: /years/i });
    await years.fill('50');
    await userEvent.tab();
    expect(store.policy.protect.newerThanYears).toBe(50);
    await expect.element(years).not.toHaveAttribute('aria-invalid');
  });

  it('rejects 0 and out-of-range years with an announced error, keeping the policy', async () => {
    const { store } = setup();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    const years = page.getByRole('spinbutton', { name: /years/i });
    // The error region is in the accessibility tree before any error (WCAG 4.1.3).
    const alert = page.getByRole('alert');
    await expect.element(alert).toBeInTheDocument();
    await expect.element(alert).toHaveTextContent('');
    await years.fill('0');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('Enter a whole number of years from 1 to 200.');
    await expect.element(years).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(years)
      .toHaveAccessibleDescription('Enter a whole number of years from 1 to 200.');
    expect(store.policy.protect.newerThanYears).toBe(30);
    await years.fill('201');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('Enter a whole number of years from 1 to 200.');
    expect(store.policy.protect.newerThanYears).toBe(30);
    await years.fill('40');
    await userEvent.tab();
    await expect.element(alert).toHaveTextContent('');
    expect(store.policy.protect.newerThanYears).toBe(40);
  });

  it('undo and redo to a valid count clear a years error', async () => {
    const { store } = setup();
    await page.getByRole('checkbox', { name: 'Buildings newer than' }).click();
    const years = page.getByRole('spinbutton', { name: /years/i });
    await years.fill('40');
    await userEvent.tab();
    expect(store.policy.protect.newerThanYears).toBe(40);
    await years.fill('0');
    await userEvent.tab();
    await expect.element(years).toHaveAttribute('aria-invalid', 'true');
    store.undo();
    await expect.element(years).toHaveValue(30);
    await expect.element(years).not.toHaveAttribute('aria-invalid');
    await expect.element(page.getByRole('alert')).toHaveTextContent('');
    await years.fill('0');
    await userEvent.tab();
    await expect.element(years).toHaveAttribute('aria-invalid', 'true');
    store.redo();
    await expect.element(years).toHaveValue(40);
    await expect.element(years).not.toHaveAttribute('aria-invalid');
    await expect.element(page.getByRole('alert')).toHaveTextContent('');
  });

  it('offers three categories and the years input, and no protect brush', async () => {
    setup();
    expect(page.getByRole('checkbox').elements()).toHaveLength(3);
    await expect.element(page.getByRole('spinbutton', { name: /years/i })).toBeInTheDocument();
    expect(
      page.getByRole('button', { name: 'Protect lots with the brush' }).elements()
    ).toHaveLength(0);
    expect(page.getByText(/Protected with the brush/).elements()).toHaveLength(0);
  });
});
