<script lang="ts">
  interface WinCardProps {
    /** 'Room for 82,069 homes' | 'Goal reached in Mar 2049'. */
    title: string;
    /** What levelling up unlocks, in words; null when the round is complete. */
    unlocks: string | null;
    onlevelup: () => void;
    onkeep: () => void;
  }

  // The stub reads its props and uses none of them.
  // eslint-disable-next-line no-empty-pattern
  let {}: WinCardProps = $props();
</script>
