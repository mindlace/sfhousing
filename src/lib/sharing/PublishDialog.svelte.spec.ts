import { createRawSnippet, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { REPO_URL } from '$lib/config';
import { MAX_PLAN_BYTES, planByteSize, serializePlan, type Plan, type PlanOp } from '$lib/plan';
import { COPY, cannotRead, sizeLine, tooLarge } from './copy';
import { sha256Hex } from './hash';
import SiteHeader from '$lib/shell/SiteHeader.svelte';
import PublishButton from './PublishButton.svelte';
import SaveIndicator from './SaveIndicator.svelte';

const ORIGIN = 'https://example.test';

const smallPlan = (): Plan => ({
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: [
    { id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] },
    { id: 's2', kind: 'erase', radiusM: 8, path: [[-122.4189, 37.76013]] }
  ]
});

const emptyPlan = (): Plan => ({ schema: 1, datasetVersion: 'fixture-0', ops: [] });

function bigPlan(): Plan {
  const ops: PlanOp[] = [];
  for (let i = 0; i < 4500; i++) {
    ops.push({ id: `o${i}`, kind: 'erase', radiusM: 5, path: [[-122.42, 37.76]] });
  }
  return { schema: 1, datasetVersion: 'fixture-0', ops };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
const err = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: { code, message: 'server copy' } }, headers);

type Props = {
  plan?: Plan;
  lastPublished?: { id: string; hash: string };
  fetchFn?: typeof fetch;
};

async function setup(p: Props = {}) {
  const fetchFn = p.fetchFn ?? (vi.fn() as unknown as typeof fetch);
  const onpublished = vi.fn();
  const plan = p.plan ?? smallPlan();
  await render(PublishButton, {
    plan,
    lastPublished: p.lastPublished,
    onpublished,
    fetchFn,
    origin: ORIGIN
  });
  return { fetchFn: fetchFn as unknown as ReturnType<typeof vi.fn>, onpublished, plan };
}

const dialog = () => page.getByRole('dialog');
const headerButton = () => page.getByTestId('publish-open');
const dialogPublish = () => dialog().getByRole('button', { name: 'Publish', exact: true });
const titleInput = () => dialog().getByLabelText('Title');

async function openForm() {
  await expect.element(headerButton()).toHaveTextContent('Publish');
  await userEvent.click(headerButton());
  await expect.element(dialog().getByRole('heading', { name: COPY.dialogHeading })).toBeVisible();
}

describe('PublishButton + PublishDialog', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('empty plan: Publish is disabled and described by "Paint something first."', async () => {
    await setup({ plan: emptyPlan() });
    const btn = headerButton();
    await expect.element(btn).toHaveTextContent('Publish');
    await expect.element(btn).toBeDisabled();
    await expect.element(btn).toHaveAccessibleDescription(COPY.disabledHint);
    const id = btn.element().getAttribute('aria-describedby');
    expect(document.getElementById(id ?? '')?.textContent).toBe('Paint something first.');
  });

  it('form: heading, prefilled title (maxlength 120), body copy and size line', async () => {
    const plan = { ...smallPlan(), title: 'Mission infill' };
    await setup({ plan });
    await openForm();
    await expect.element(titleInput()).toHaveValue('Mission infill');
    await expect.element(titleInput()).toHaveAttribute('maxlength', '120');
    await expect.element(dialog().getByText(COPY.dialogBody)).toBeVisible();
    await expect.element(dialog().getByText(sizeLine(planByteSize(plan)))).toBeVisible();
    await expect.element(dialog().getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('oversize preflight: Publish disabled, too-large copy inline, no request', async () => {
    const plan = bigPlan();
    const bytes = planByteSize(plan);
    expect(bytes).toBeGreaterThan(MAX_PLAN_BYTES);
    const { fetchFn } = await setup({ plan });
    await openForm();
    await expect.element(dialogPublish()).toBeDisabled();
    await expect.element(dialog().getByText(tooLarge(bytes))).toBeVisible();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('publishing: busy state, and a double click sends one request (Review Focus 2)', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    const el = dialogPublish().element() as HTMLButtonElement;
    el.click();
    el.click();
    const busy = dialog().getByRole('button', { name: 'Publishing…' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    await expect.element(busy).toBeDisabled();
    await expect.element(titleInput()).toBeDisabled();
    await expect.element(dialog().getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('success: link, Copy → Copied, onpublished with normalised title and its hash (RF1)', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const fetchFn = vi.fn(async () => json(201, { id: 'AbCdEfGh' }));
    const { onpublished } = await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.fill(titleInput(), '  My plan  ');
    await userEvent.click(dialogPublish());

    await expect.element(dialog().getByRole('heading', { name: 'Published' })).toBeVisible();
    const link = dialog().getByLabelText('Link');
    await expect.element(link).toHaveValue('https://example.test/p/AbCdEfGh');
    await expect.element(link).toHaveAttribute('readonly');
    await expect
      .element(dialog().getByRole('link', { name: /Open/ }))
      .toHaveAttribute('href', 'https://example.test/p/AbCdEfGh');

    expect(onpublished).toHaveBeenCalledTimes(1);
    const r = onpublished.mock.calls[0][0] as { id: string; hash: string; plan: Plan };
    expect(r.id).toBe('AbCdEfGh');
    expect(r.plan.title).toBe('My plan');
    expect(r.hash).toBe(await sha256Hex(serializePlan(r.plan)));
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(serializePlan(r.plan));

    await userEvent.click(dialog().getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('https://example.test/p/AbCdEfGh');
    await expect.element(dialog().getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect.element(dialog().getByRole('status')).toHaveTextContent('Link copied');

    await userEvent.click(dialog().getByRole('button', { name: 'Done' }));
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it('already published: button reads "Share link" and opens success without a request', async () => {
    const plan = smallPlan();
    const hash = await sha256Hex(serializePlan(plan));
    const { fetchFn } = await setup({ plan, lastPublished: { id: 'Stored12', hash } });
    await expect.element(headerButton()).toHaveTextContent('Share link');
    await userEvent.click(headerButton());
    await expect.element(dialog().getByRole('heading', { name: 'Published' })).toBeVisible();
    await expect
      .element(dialog().getByLabelText('Link'))
      .toHaveValue('https://example.test/p/Stored12');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a stale lastPublished hash leaves the button as "Publish"', async () => {
    await setup({ lastPublished: { id: 'Stored12', hash: 'deadbeef' } });
    // Give the hash effect time to resolve, then confirm it did not switch to "Share link".
    await expect.element(headerButton()).toHaveAttribute('data-hashed', 'true');
    await expect.element(headerButton()).toHaveTextContent('Publish');
    await expect.element(headerButton()).toBeEnabled();
  });

  it('413: too-large copy in the alert, Publish disabled until the title changes', async () => {
    const plan = smallPlan();
    const fetchFn = vi.fn(async () => err(413, 'too_large'));
    await setup({ plan, fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(tooLarge(planByteSize(plan)));
    await expect.element(dialogPublish()).toBeDisabled();
    await userEvent.fill(titleInput(), 'x');
    await expect.element(dialogPublish()).toBeEnabled();
  });

  it('422 too_many_ops copy', async () => {
    const fetchFn = vi.fn(async () => err(422, 'too_many_ops'));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    await expect.element(dialog().getByRole('alert')).toHaveTextContent(COPY.tooManyOps);
    await expect.element(dialogPublish()).toBeEnabled();
  });

  it('422 unknown_dataset_version copy', async () => {
    const fetchFn = vi.fn(async () => err(422, 'unknown_dataset_version'));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    await expect.element(dialog().getByRole('alert')).toHaveTextContent(COPY.unknownDataset);
  });

  it('422 invalid_plan: cannot-read copy and a Report an issue link', async () => {
    const fetchFn = vi.fn(async () => err(422, 'invalid_plan'));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    const alert = dialog().getByRole('alert');
    await expect.element(alert).toHaveTextContent(cannotRead('invalid_plan'));
    await expect
      .element(alert.getByRole('link', { name: /Report an issue/ }))
      .toHaveAttribute('href', `${REPO_URL}/issues`);
  });

  it('429: rate-limited copy and a countdown from Retry-After that re-enables Publish', async () => {
    const fetchFn = vi.fn(async () => err(429, 'rate_limited', { 'retry-after': '2' }));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    vi.useFakeTimers();
    await userEvent.click(dialogPublish());
    await expect.element(dialog().getByRole('alert')).toHaveTextContent(COPY.rateLimited);
    await expect.element(dialogPublish()).toBeDisabled();
    await expect.element(dialog().getByText('You can publish again in 2 s.')).toBeVisible();
    vi.advanceTimersByTime(1000);
    await expect.element(dialog().getByText('You can publish again in 1 s.')).toBeVisible();
    vi.advanceTimersByTime(1000);
    await expect.element(dialogPublish()).toBeEnabled();
    await expect.element(dialog().getByText(/You can publish again/)).not.toBeInTheDocument();
    await expect.element(dialog().getByRole('alert')).toHaveTextContent('');
  });

  it('fetch rejecting: network copy, Publish re-enabled', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    await expect.element(dialog().getByRole('alert')).toHaveTextContent(COPY.network);
    await expect.element(dialogPublish()).toBeEnabled();
  });

  it('Escape closes the dialog', async () => {
    await setup();
    await openForm();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it('Escape does not close the dialog while a publish is pending', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openForm();
    await userEvent.click(dialogPublish());
    const busy = dialog().getByRole('button', { name: 'Publishing…' });
    await expect.element(busy).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).toBeInTheDocument();
    await expect.element(busy).toBeVisible();
    expect((dialog().element() as HTMLDialogElement).open).toBe(true);
  });

  it('Cancel closes the dialog', async () => {
    await setup();
    await openForm();
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }));
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it('the dialog is modal (opened with showModal)', async () => {
    await setup();
    await openForm();
    const el = dialog().element() as HTMLDialogElement;
    expect(el.matches(':modal')).toBe(true);
  });

  it('fits the 48 px header at 375 px with the widest states ("Autosave off" + "Share link")', async () => {
    await page.viewport(375, 700);
    const plan = smallPlan();
    const hash = await sha256Hex(serializePlan(plan));
    const actions = createRawSnippet(() => ({ render: () => '<div data-testid="slot"></div>' }));
    await render(SiteHeader, { actions });
    const slot = page.getByTestId('slot').element() as HTMLElement;
    const a = mount(SaveIndicator, { target: slot, props: { status: 'off' } });
    const b = mount(PublishButton, {
      target: slot,
      props: {
        plan,
        lastPublished: { id: 'Stored12', hash },
        onpublished: () => {},
        origin: ORIGIN
      }
    });
    try {
      await expect.element(headerButton()).toHaveTextContent('Share link');
      await expect.element(page.getByRole('button', { name: 'Autosave off' })).toBeVisible();
      const header = page.getByRole('banner').element() as HTMLElement;
      expect(header.getBoundingClientRect().height).toBe(48);
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      const btnBox = headerButton().element().getBoundingClientRect();
      expect(btnBox.height).toBeGreaterThanOrEqual(24);
      expect(btnBox.right).toBeLessThanOrEqual(375);
    } finally {
      await unmount(a);
      await unmount(b);
    }
  });
});
