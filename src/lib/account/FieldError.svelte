<script lang="ts">
  interface Props {
    /** id the host input's aria-describedby points at */
    id: string;
    /** id of the invalid input, focused on mount (focus-first-invalid) */
    forId: string;
    /** Null when there is no error: renders nothing, so a host can mount this
     *  unconditionally instead of wrapping it in its own {#if}. */
    message: string | null;
  }
  let { id, forId, message }: Props = $props();

  $effect(() => {
    // Server-action errors re-render the form (enhance or full page); focusing
    // the invalid field on mount makes AT announce the error via the field's
    // aria-describedby association. Guarded on message so an unconditionally-mounted
    // FieldError doesn't steal focus back on every render once the error clears.
    if (message) document.getElementById(forId)?.focus();
  });
</script>

{#if message}
  <p class="text-sm font-medium text-red-800 dark:text-red-300" {id} data-testid={`${forId}-error`}>
    {message}
  </p>
{/if}
