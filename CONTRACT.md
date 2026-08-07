# What this extension depends on in Frappe Builder

This lives in its own repository, so the two sides can no longer be changed in one
commit. These are the only things that have to stay true. If a change in Builder breaks
one of them, pasting breaks here.

## 1. The clipboard type

Builder's paste handler reads the custom clipboard type **`builder-copied-blocks`**.

- Builder: `frontend/src/utils/builderBlockCopyPaste.ts`, `pasteBuilderBlocks()`
- Here: `shared/clipboard.js`

Chrome keeps unknown clipboard types in a private format that is readable across origins
within the same browser, which is what lets a copy on any site paste into Builder.

## 2. The payload

The value is JSON. Builder reads these keys:

| Key                      | Meaning                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocks`                 | Array with one root block. `originalElement: "body"` and `blockId: "root"` make it a page rather than a fragment.                                                            |
| `components`             | Builder Component docs (`name`, `component_id`, `component_name`, `block` as a JSON string).                                                                                 |
| `variables`              | Builder Token docs (`name`, `token_name`, `value`, `type`, `group`). Styles reference them as `var(--<name>)`.                                                               |
| `sourceURL`              | Origin of the copy. When it differs from the Builder origin, Builder rehashes component, token, and script ids so nothing collides. This is always true here.                |
| `pageDoc`                | Builder Page fields. Present means "this is a page", which is what triggers the new page or replace prompt. Leave `blocks` out of it: Builder fills that in from `blocks`.   |
| `pageScripts`            | Builder Client Script docs (`name`, `script_type` of `JavaScript` or `CSS`, `script`).                                                                                       |
| `pageDoc.client_scripts` | Which of those the page uses, as `{ builder_script, idx }`.                                                                                                                  |
| `fonts`                  | Webfonts the blocks use, as `{ family, url, weight, style }`. Builder offers to download each one and recreate it as a User Font. One file per family is all Builder stores. |

Unknown keys are ignored, so adding to the payload is safe. Renaming or removing one of
the above is not.

## 3. Builder's reset

Styles are only worth copying when Builder would render them differently, so the
comparison is made against Builder's reset rather than the browser's defaults.

Set a Builder site in the popup and the reset is fetched from
`<site>/assets/builder/reset.css` and cached for a day, which keeps this correct on its
own. `BUILDER_BASELINE_CSS` in `content/namespace.js` is the fallback for when no site is
configured, and it is a copy of the parts of `builder/public/reset.css` that affect the
properties this extension reads.

## 4. Breakpoints

Tablet and mobile styles are sampled at 800 and 420 pixels, matching the canvas widths in
Builder's `BuilderCanvas.vue`. Published pages apply them below 1024 and 576 pixels
(`MOBILE_BREAKPOINT` and `DESKTOP_BREAKPOINT` in `builder_page.py`).
