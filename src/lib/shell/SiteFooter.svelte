<script lang="ts">
  import { REPO_URL } from '$lib/config';
</script>

<footer class="px-4 py-2 text-sm">
  <nav aria-label="Footer" class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <a href="/about" class="underline">About</a>
    <span aria-hidden="true">·</span>
    <a href="/attribution" class="underline">Data &amp; licences</a>
    <span aria-hidden="true">·</span>
    <a href={REPO_URL} class="underline">Source code (GitHub)</a>
  </nav>
</footer>
