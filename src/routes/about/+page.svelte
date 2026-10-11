<script lang="ts">
  import { REPO_URL } from '$lib/config';
</script>

<svelte:head><title>About · SF Housing Simulator</title></svelte:head>

<h1 class="text-2xl font-semibold">About</h1>

<h2 class="mt-6 text-lg font-semibold">What this is</h2>
<p class="mt-3">
  I built this so you can paint zoning changes on a map of San Francisco and see how many homes they
  could allow. Pick an area, choose what the rules would permit there, and watch the totals move.
</p>

<h2 class="mt-6 text-lg font-semibold">What the numbers mean</h2>
<p class="mt-3">
  The numbers are <strong>theoretical maximum buildout, not a forecast</strong>. They show what the
  rules would permit if every eligible parcel were built to the limit, not what will actually get
  built, or when.
</p>
<p class="mt-3">
  For scale, San Francisco's RHNA 6th-cycle target is <strong>82,069</strong> homes (<strong
    >94,379</strong
  >
  with the 15% buffer). See
  <a
    class="underline"
    href="https://sfplanning.org/project/housing-element-update-2022"
    rel="noopener noreferrer">SF Planning's Housing Element</a
  > for how that target was set.
</p>

<h2 class="mt-6 text-lg font-semibold">Your plans</h2>
<p class="mt-3">
  <strong>Published plans are public and permanent.</strong> Anyone with the link can see them, and I
  can't take them back, so don't put anything in a plan you wouldn't want shared.
</p>

<h2 class="mt-6 text-lg font-semibold">Code and data</h2>
<p class="mt-3">
  The code is MIT licensed; see the
  <a class="underline" href="{REPO_URL}/blob/main/LICENSE">LICENSE</a>. Data sources and their
  licences are listed on the <a class="underline" href="/attribution">data and licences page</a>.
</p>
