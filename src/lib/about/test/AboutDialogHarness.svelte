<!-- Test harness: AboutDialog with openers around it. A header-like Menu button and panel (the
     panel hides when its link is pressed, as SiteHeader's does), plain About links, a link to
     another page, a new-tab link, and buttons that call open() directly. -->
<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import AboutDialog from '../AboutDialog.svelte';

  let props: ComponentProps<typeof AboutDialog> = $props();
  let dialog: AboutDialog;
  let menuOpen = $state(false);
</script>

<button
  type="button"
  data-header-menu
  aria-expanded={menuOpen}
  onclick={() => (menuOpen = !menuOpen)}>Menu</button
>
<div class={menuOpen ? '' : 'hidden'} data-testid="menu-panel">
  <a href="/about" onclick={() => (menuOpen = false)}>About in the Menu</a>
</div>
<button type="button" onclick={() => dialog.open()}>Sources</button>
<button type="button" onclick={() => dialog.open('src-transition-discretionary-entitled')}>
  Open at entitled
</button>
<button type="button" onclick={() => dialog.open('about-data')}>Open at data</button>
<a href="/about">About</a>
<a href="/about#about-data">Data link</a>
<a href="/about#src-transition-discretionary-entitled">Entitled link</a>
<a href="/sim">Other page</a>
<a href="/about" target="_blank">New tab</a>
<AboutDialog bind:this={dialog} {...props} />
