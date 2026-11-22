/**
 * The link rule (docs/dev/about.md): while About's dialog is mounted (/sim, /s/<id>), a plain click
 * on a link to /about opens the dialog at the link's fragment instead of leaving the page. Every
 * way into About is an ordinary link (the header's About, the map's credit, Details' last line),
 * so a modified click still opens the page in a new tab and nothing else needs to know.
 */

const ABOUT_PATH = '/about';

/**
 * The fragment an About link opens ('' for /about itself), or null when `a` is not a same-origin
 * link to /about. Pure: reads a.href, a.target, a.hasAttribute('download') and `origin`. The
 * fragment is taken as written (About's ids are ASCII), so a malformed one never throws.
 */
export function aboutTarget(a: HTMLAnchorElement, origin: string): string | null {
  if (!a.href || a.hasAttribute('download')) return null;
  if (a.target !== '' && a.target !== '_self') return null;
  let url: URL;
  try {
    url = new URL(a.href);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== ABOUT_PATH) return null;
  return url.hash.slice(1);
}

/**
 * While installed: a capture-phase click listener on `document` that, for a plain click (button
 * 0, no Ctrl, Meta, Shift or Alt, not already handled, no target other than _self) on an About
 * link, calls preventDefault() and open(fragment). Returns the uninstall. It runs before
 * SvelteKit's router, which skips a handled click. Enter on a focused link is a click too.
 */
export function interceptAboutLinks(
  open: (fragment: string, link: HTMLAnchorElement) => void
): () => void {
  const onclick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const from = e.composedPath()[0];
    const a = from instanceof Element ? from.closest('a') : null;
    if (!(a instanceof HTMLAnchorElement)) return;
    const fragment = aboutTarget(a, location.origin);
    if (fragment === null) return;
    e.preventDefault();
    open(fragment, a);
  };
  document.addEventListener('click', onclick, { capture: true });
  return () => document.removeEventListener('click', onclick, { capture: true });
}
