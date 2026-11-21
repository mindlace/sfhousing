<script lang="ts">
  // Test host: one Message, with a Retry action and, with `withDetails`, a details list.
  import Message from '../Message.svelte';
  import type { MessageShape } from '../ui';

  let {
    text,
    shape = undefined,
    still = false,
    withActions = true,
    withDetails = false
  }: {
    text: string;
    shape?: MessageShape;
    still?: boolean;
    withActions?: boolean;
    withDetails?: boolean;
  } = $props();
</script>

{#snippet retry()}
  <button type="button">Retry</button>
{/snippet}
{#snippet list()}
  <ul><li>One detail</li></ul>
{/snippet}

<div style="width: 600px">
  <Message
    {text}
    {shape}
    {still}
    testid="msg"
    actions={withActions ? retry : undefined}
    details={withDetails ? list : undefined}
  />
</div>
