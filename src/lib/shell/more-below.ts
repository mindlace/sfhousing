/**
 * {@attach moreBelow}: sets data-more on the box while its content overflows and it is not
 * scrolled to within 1 px of its end. Reads on scroll (passive) and on a ResizeObserver of the box
 * and its element children (re-observed as they change, so a replaced child is watched too); no
 * animation frame, no timer. The cue it drives is `.more-below` (src/routes/layout.css): a fade at
 * the box's foot, a 2 px line under forced colours. Works in every browser, scroll timelines or not.
 */
export function moreBelow(node: HTMLElement): () => void {
  const read = () => {
    const more = node.scrollHeight - node.clientHeight - node.scrollTop > 1;
    if (more !== node.hasAttribute('data-more')) node.toggleAttribute('data-more', more);
  };
  const sizes = new ResizeObserver(read);
  let watched: Element[] = [];
  const watch = () => {
    for (const c of watched) sizes.unobserve(c);
    watched = [...node.children];
    for (const c of watched) sizes.observe(c);
    read();
  };
  sizes.observe(node);
  watch();
  const children = new MutationObserver(watch);
  children.observe(node, { childList: true });
  node.addEventListener('scroll', read, { passive: true });
  return () => {
    node.removeEventListener('scroll', read);
    children.disconnect();
    sizes.disconnect();
    node.removeAttribute('data-more');
  };
}
