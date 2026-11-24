# src/ui

React shell for the booth: `main.tsx` composes the screens (ready, capturing, review,
finished) and owns the session flow and operator forms; `style.css` holds the styles;
`electron.d.ts` types the `window.photobooth` bridge.

Reusable pieces live in `../renderer/` (components, hooks, lib) and feature rules come
from `../features/*` barrels. See `docs/architecture.md` for the dependency rules and
the plan for shrinking `main.tsx` further.
