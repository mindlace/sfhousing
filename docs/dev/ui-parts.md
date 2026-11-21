# Shared UI parts

`src/lib/shell/ui.ts` holds the app's shared looks as Tailwind class constants (Tailwind scans them;
`accent.spec.ts` checks that every gray, white, black or ink utility in them has its `dark:`
partner, and that the file has no hex). Colours come only from the tokens in
`src/routes/layout.css`. Files adopt the parts as work touches them; a file that does goes into
`THEMED_FILES` in `src/lib/shell/accent.spec.ts`.

**Use a part, or add one.** Use a part as it is and put only position and size beside it; never
restate or override its look. Add a part to `ui.ts` only when a look is needed in a second place,
is meant to stay the same in both, and no part fits. A new part gets its check in `ui.spec.ts`,
and its file joins `THEMED_FILES`.

## The spacing scale

`SPACE_STEPS = [1, 2, 3, 4, 6]`: Tailwind steps of 4, 8, 12, 16 and 24 px. The parts use only these
for padding, margin and gap (`ui.spec.ts` checks every constant). Arbitrary px are for measured
geometry only, with a comment saying so.

## Buttons

| Kind             | Use                                                                   | Look                                                                                         |
| ---------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `BUTTON`         | Any other action (Cancel, Copy link, Remix's "Start your own")        | control-line border, surface, ink, text-sm semibold, rounded-md, px-2; hover one step raised |
| `BUTTON_PRIMARY` | The page's main action (Publish, Done, Replace)                       | accent fill, on-accent text; otherwise as `BUTTON`                                           |
| `BUTTON_QUIET`   | An action inside a message (Retry, Details, a link), a dialog's Close | no border, underlined, semibold                                                              |
| `BUTTON_DISMISS` | A message's dismiss (`Message` draws it, the drawn ×)                 | as `BUTTON_QUIET` without the underline, icon centred, hover one step raised                 |
| `ON_MAP`         | Added to a button over the map                                        | a small shadow, so it reads on any map                                                       |

Every kind carries `TARGET` (`min-h-6 min-w-6`): at least 24 by 24 px on every pointer, mouse and
touch alike, with nothing larger on a coarse pointer (the target rule is in
[accessibility.md](accessibility.md)). A control that is none of the kinds (a field, a switch's
label, a summary, a row) takes at least `min-h-6 min-w-6`, as `TARGET` or as those classes written
beside its own look (most files write the classes; `TARGET` is their one definition). All show the accent outline on `:focus-visible`. Off (`disabled` or
`aria-disabled="true"`) they read in muted ink (the primary loses its fill for the raised surface),
take no hover, and show `cursor: not-allowed`. A button that must say why it is off is
`aria-disabled`, not `disabled`, so it keeps focus and can carry an `Explain` (Publish; see
[plan-sharing.md](plan-sharing.md)); its handler returns early while off.

## Surfaces

| Surface                | Use                                                                                                                | Look                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `SURFACE_POP`          | Menus, panels, pop-overs (the key's panels, the palette strip's pop-overs, Shortcuts, the "Autosave off" pop-over) | rounded-lg, line border, surface, ink, shadow-lg, p-2, text-sm |
| `SURFACE_TIP`          | An explanation's tooltip (`Explain`)                                                                               | as `SURFACE_POP` with rounded, px-2 py-1, shadow-md            |
| `SURFACE_DIALOG`       | A modal dialog (Publish, Remix's confirm)                                                                          | rounded-lg, surface, ink, shadow-xl, p-4, a 40% black backdrop |
| `SURFACE_DIALOG_FLUSH` | A dialog that pads its own regions (Sources)                                                                       | `SURFACE_DIALOG` without the padding                           |

In dark every surface is `surface-dark` with `ink-dark` text; a dialog also takes a `line-dark`
border to set it off from the dimmed page. Pop-overs and dialogs declare `color-scheme: dark` in
dark (`dark:scheme-dark`), so a native scrollbar or field inside them follows the theme. So does
the root layout's wrapper on the full-height map pages, which are themed whole; the document pages
are light at every setting and declare nothing, so they never turn dark. The constants carry no position or size: the component
adds those (`absolute top-full mt-1 w-64 …`) beside the constant.

`Explain` draws `SURFACE_TIP` from md as `md:`-prefixed classes (below md the text is a muted line
under its target), and `layout.css`'s `.explain-under` repeats the values in CSS for a tooltip that
opens under its target. `ui.spec.ts` keeps both in step with the constant: Explain's class list
token for token, and the CSS rule's padding, border, radius, surface, ink and two-layer shadow,
light and dark.

## Scroll boxes

A box that scrolls and should say more is below takes `class="more-below"` and
`{@attach moreBelow}` (`src/lib/shell/more-below.ts`, which sets `data-more` while the box is not
scrolled to within 1 px of its end). The look is `.more-below` in `src/routes/layout.css`: a 24 px
fade to `surface` (`surface-dark` in dark) sticks to the foot, takes no press, and focus scrolls
clear of it; under forced colours it is a 2 px `CanvasText` line. The fade ends in `surface`, so use
it only on a `surface` box. Used by the `/sim` detail column (and the phone sheet, the same box) and
the map toolbar's Key and Layers panels.

## Messages: chips and cards

| Shape        | Use                                                    | Look                                                                      |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `CHIP`       | A few words, with an action or a dismiss               | rounded-full, one line, surface (surface-raised in dark), shadow, text-sm |
| `CHIP_PLAIN` | A few words with no action ("Loading the simulation…") | as `CHIP`, even padding                                                   |
| `CHIP_STILL` | A chip that takes no presses (the stroke chip)         | as `CHIP`, `pointer-events: none`, even padding                           |
| `CARD`       | A paragraph                                            | rounded-lg, wraps at 28rem, its actions in a row under it                 |

`messageShape(text, details?)` picks the shape from the words, so the same message always looks
the same: one sentence of at most 8 words with no details is a `'chip'`; anything else is a
`'card'`.

### `Message`

`src/lib/shell/Message.svelte` renders one message in its shape. Props: `text`; `shape` (default
`messageShape(text, !!details)`); `actions` (a snippet: its buttons are `BUTTON_QUIET`);
`ondismiss` (the one dismiss, `BUTTON_DISMISS` with the drawn × and named "Dismiss", given the
press's event); `details`
(a snippet shown under the text, which makes it a card); `still` (`CHIP_STILL`); `testid` (on its
root, which carries `data-shape="chip"` or `"card"`). A chip is the text then the actions on one
line, the dismiss last (a chip with no action pads its right as its left); a card is the text, then
the actions in a row under it, then the details, and its dismiss sits top right on the text's first
line, pulled into the padding so it adds no height (a card whose only action is the dismiss has no
second row).

It has no role of its own: the page keeps its `role="status"` / `role="alert"` containers
(usually `display: contents` wrappers mounted empty), so what is announced and when does not
change. `textRole` and `textTestid` put a role and test id on the words alone, for a page whose
live region is the words without the actions (`/sim`'s load failure alert).

Every notice on the four map pages is a `Message`: the notice stack (`NoticePills`) on `/sim`
(TimelineMode's notices, `SimNotices`) and on `/` and `/p/:id` (the brush status, `NoticeStack`),
the stroke chip (always `shape="chip"` and `still`, whatever its words: a stroke can start under
it), and Activity's refused starter (a card). Map-view's failure messages keep the map palette
(`.sim-map-panel`, shared with `/lesscars`) but follow the same shapes: parcels' one line is
rounded-full, buildings' sentence rounded-lg ([map-interfaces.md](map-interfaces.md)).
