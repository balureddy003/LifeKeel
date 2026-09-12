# Logo assets

The app icon (`apps/family/public/icon.svg`) is unchanged and is the source of truth for the mark itself — these
files extend it into a lockup system, they don't replace it.

- `logo-horizontal.svg` — icon + wordmark, for headers and navigation
- `logo-stacked.svg` — icon above wordmark, for square contexts (social avatars, splash screens, deck title slides)
- `logo-mono-white.svg` — icon only, all white, no container — for a single-color context on a dark ground
- `logo-mono-ink.svg` — icon only, all near-black, no container — for a single-color context on a light ground

## Before using the horizontal/stacked lockups outside a browser

The wordmark in `logo-horizontal.svg` and `logo-stacked.svg` is a live `<text>` element set in Fraunces. That
renders correctly in a browser (or anywhere Fraunces is available), but for a context that can't guarantee font
access — print, a store listing, opening the file in a design tool on a machine without the font installed — convert
the text to outline paths first (Figma, Illustrator, or `text-to-path`/similar). The mono and icon-only files have
no such dependency; they're pure geometry and safe to use anywhere as-is.

## Minimum size

16px is the floor — below that the lattice starts to fuzz into a blob. Keep the corner radius proportional
(~22% of width) at every size.

See the full system, on-light/on-dark previews, and the size/spacing rules at the published review artifact
(ask in the project if you don't have the link).
