<script lang="ts">
  interface Props {
    /** Empty string when idle: the node stays mounted; only text mutates. */
    message: string;
    /** Focus the node when a message arrives (confirmations that replace a form). */
    focus?: boolean;
    tone?: 'info' | 'error';
    testid?: string;
  }
  let { message, focus = false, tone = 'info', testid = 'form-status' }: Props = $props();
  let el = $state<HTMLParagraphElement | null>(null);

  $effect(() => {
    if (focus && message) el?.focus();
  });
</script>

<p
  bind:this={el}
  role="status"
  aria-live="polite"
  tabindex="-1"
  class="text-sm data-[tone=error]:font-medium data-[tone=error]:text-red-800 dark:data-[tone=error]:text-red-300"
  data-tone={tone}
  data-testid={testid}
>
  {message}
</p>
