<script lang="ts">
  // Test host: `/`'s wiring of plan sharing's notices, as `src/routes/+page.svelte` does it.
  // NoticeStack is BrushEditor's `notices` snippet, so its pills land in BrushEditor's one notice
  // stack; a dismissal takes the notice out of the page's list.
  import type { Manifest } from '$lib/data/manifest';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { emptyPlan } from '$lib/plan';
  import type { WorkerLike } from '$lib/sim/client';
  import NoticeStack from '../NoticeStack.svelte';

  type Notice = { id: string; text: string; tone?: 'info' | 'toast' };

  let {
    manifest,
    initial,
    ondismiss
  }: { manifest: Manifest; initial: Notice[]; ondismiss: (id: string) => void } = $props();

  // svelte-ignore state_referenced_locally
  let notices = $state<Notice[]>(initial);

  const idleWorker = (): WorkerLike => ({ onmessage: null, postMessage() {}, terminate() {} });
</script>

{#snippet noticeStack()}
  <NoticeStack
    {notices}
    ondismiss={(id) => {
      ondismiss(id);
      notices = notices.filter((n) => n.id !== id);
    }}
  />
{/snippet}

<div id="map-region" class="relative" style="height: 600px">
  <BrushEditor
    {manifest}
    manifestError={false}
    plan={emptyPlan('fixture-0')}
    currentVersion="fixture-0"
    reloadManifest={async () => manifest}
    createWorker={idleWorker}
    notices={noticeStack}
  />
</div>
