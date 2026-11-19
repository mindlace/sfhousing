// The 12-word rest-text rule (accessibility.md): what a page shows at rest. Shared by the `/sim`
// and `/` specs.

function visibleTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = (n as Text).parentElement;
    if (el && (n as Text).textContent!.trim() && el.checkVisibility()) out.push(n as Text);
  }
  return out;
}

/**
 * Visible text nodes of 12 words or more outside a dialog, `[data-notice]`, `[data-explain-open]`
 * or `.sr-only`, trimmed.
 */
export function longTexts(root: Node = document.body): string[] {
  return visibleTextNodes(root)
    .filter(
      (n) => !n.parentElement!.closest('dialog, [data-notice], [data-explain-open], .sr-only')
    )
    .map((n) => n.textContent!.trim())
    .filter((t) => t.split(/\s+/).length >= 12);
}
