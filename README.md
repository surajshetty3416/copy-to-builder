# Copy to Frappe Builder

A Chrome extension that copies any web page, or any single element on it, and pastes it
into Frappe Builder as native, editable blocks.

Nothing is exported or uploaded. The page is converted in the tab you are looking at and
written to the clipboard under the same custom type Builder's own copy uses
(`builder-copied-blocks`), so pasting is just Cmd/Ctrl + V on a Builder canvas.

Built for [Frappe Builder](https://github.com/frappe/builder), and released separately
from it. What it relies on Builder for is written down in [CONTRACT.md](CONTRACT.md).

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Pin the extension if you want the toolbar button.
4. Optional: put your Builder site's URL in the popup. Styles are then compared against
   that site's own reset instead of the copy bundled here, which keeps the conversion
   correct as Builder changes.

## Use

- **Copy whole page**: click the extension, then **Copy whole page**. On the Builder
  canvas press Cmd/Ctrl + V. Builder asks whether to create a new page or replace the
  current one.
- **Copy one element**: click **Pick an element**, hover to highlight, click to copy.
  Arrow Up and Down widen or narrow the selection, Esc cancels. Paste it into any
  container on the canvas.
- Keyboard: Cmd/Ctrl + Shift + Y copies the page, Cmd/Ctrl + Shift + U starts the picker.
  Both are also in the right click menu.

## What comes across

|                     |                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure           | Semantic containers, text, links, buttons, images, video, inline SVG, forms and inputs. Text lands in text blocks so it stays inline editable.                                                                      |
| Styles              | Every style the page actually applies, resolved from the live page, compared against Builder's own reset so only real differences are copied.                                                                       |
| Responsive          | Tablet and mobile styles read out of the page's own media queries and written to Builder's tablet and mobile breakpoints.                                                                                           |
| Tokens              | The repeated palette and typography become Builder Tokens named by role (Background, Text, Primary, Border), and the styles reference them with `var(...)`.                                                         |
| Components          | Runs of three or more identical sibling blocks (cards, nav items, tiles) become one Builder Component with per-instance overrides for the text and images that differ.                                              |
| Page settings       | Title, meta description, social image, favicon, and the webfont links the page needs. Indexing is turned off, since a copy should not compete with the original.                                                    |
| Layer names         | Blocks are named from their role or class (Hero, Card, Nav, Footer) so the layers panel is readable.                                                                                                                |
| Hover and animation | The rules a block cannot hold (`:hover`, `:focus`, `::before`, `@keyframes`) travel as a CSS Builder Client Script, with `var()` resolved and only the class names those rules need kept on the blocks.             |
| Page JavaScript     | Off by default. When on, the page's inline scripts become a JavaScript Builder Client Script you can read and edit in Builder's Code panel before publishing.                                                       |
| Fonts               | Webfonts the page uses are listed with the file each one loads. Builder offers to download them into your site as User Fonts, which puts them in the font picker and stops the copy depending on the original site. |

## How the conversion works

- **Styles** come from `getComputedStyle`, with the CSS Typed OM used for anything the
  browser would otherwise resolve to a fixed pixel value: `auto`, percentages,
  `repeat(3, 1fr)`, unitless line heights. Viewport units are read back from the rules
  so a `100vh` hero does not get frozen to the height of your window.
- **The baseline** is Builder's own reset (`builder/public/reset.css`), rendered in a
  blank frame. A style is copied when Builder would render it differently, which is why
  heading sizes and list markers survive even though the source page never declared them.
- **Responsive styles** come from a small read-only cascade: every rule is indexed by its
  rightmost selector, then resolved for the element at 1400, 800, and 420 pixels wide.
  It understands escaped class selectors, logical properties, `var()` shorthands, range
  syntax media queries, and min-width breakpoints where the narrow view is the one with
  no rule at all.
- **Cross-origin stylesheets** are refetched by the extension so sites that load CSS from
  a CDN still give up their media queries.

## Limits

- Elements hidden at the width you copy at (`display: none`) are skipped, so a mobile-only
  menu will not come across.
- Copied JavaScript ran against the original page's markup. The blocks it lands on have a
  different structure, so treat it as a starting point and review it before publishing.
  Analytics, consent, and framework hydration scripts are left behind on purpose, and
  remote scripts are listed as a comment rather than imported.
- `position: fixed` becomes `position: sticky`, which keeps the intent without pinning
  the element over the canvas while you edit.
- Images and fonts keep pointing at the site you copied from until you accept the import
  Builder offers right after the paste. Fonts especially are worth importing: a self
  hosted font is usually served without the CORS headers a cross origin webfont needs, so
  it will often fail to load until it lives on your site.
- Builder stores one file per font family, so each family comes across in its most
  ordinary face (upright, closest to regular) and other weights are synthesised by the
  browser. A variable font is preferred when the page offers one, since it covers
  every weight in a single file.
- Very large pages stop at 4000 blocks and say so.

## Files

```
manifest.json      MV3 manifest, on-demand injection, no content script until you ask
background.js      context menu, keyboard commands, cross-origin stylesheet fetch
popup.*            the toolbar UI and its options
shared/clipboard.js  writes the builder-copied-blocks clipboard type
shared/inject.js     injects the content scripts, in order, once per tab
content/cascade.js   read-only cascade: which rules win at a given viewport width
content/styles.js    computed styles, Builder baseline diffing, responsive diffs
content/elements.js  what each DOM element should become
content/blocks.js    the DOM walk that builds the block tree
content/tokens.js    palette and typography to Builder Tokens
content/components.js  repeated blocks to Builder Components
content/scripts.js   interactive CSS and page JS to Builder Client Scripts
content/page.js      page settings and webfonts
content/picker.js    element picker overlay and toasts
content/main.js      orchestration, messaging, clipboard write
```

## Working on it

There is no build step. Edit a file, hit reload on `chrome://extensions`, and the next
copy uses it. `.prettierrc` matches Builder's formatting.

Everything this depends on in Builder is listed in [CONTRACT.md](CONTRACT.md). The
short version: the `builder-copied-blocks` clipboard type, the shape of the payload, and
Builder's reset, which is fetched from your site when you configure one.
