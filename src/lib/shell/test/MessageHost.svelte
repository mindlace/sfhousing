<script lang="ts">
  // Test host: one Message, with a Retry action, with `withDetails` a details list, and with
  // `ondismiss` its dismiss.
  import Message from '../Message.svelte';
  import type { MessageShape } from '../ui';

  let {
    text,
    shape = undefined,
    still = false,
    withActions = true,
    withDetails = false,
    ondismiss = undefined
  }: {
    text: string;
    shape?: MessageShape;
    still?: boolean;
    withActions?: boolean;
    withDetails?: boolean;
    ondismiss?: () => void;
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
    {ondismiss}
  />
</div>
