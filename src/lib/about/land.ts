// Where focus goes after a link lands on a part or an entry of About: its heading (one line, so
// a focus ring is never drawn around a whole part), else the element itself.

/**
 * Focuses `el`'s first heading (or `el`) without scrolling, giving it `tabindex=-1` if it has
 * none, so a keyboard user's next Tab starts at the place they were sent.
 */
export function focusLanding(el: Element): void {
  const at = (
    el.matches('h1, h2, h3, h4, h5, h6') ? el : (el.querySelector('h1, h2, h3, h4, h5, h6') ?? el)
  ) as HTMLElement;
  if (!at.hasAttribute('tabindex')) at.tabIndex = -1;
  at.focus({ preventScroll: true });
}
