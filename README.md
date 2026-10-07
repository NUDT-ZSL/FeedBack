# React + TypeScript + Vite

## Offline layout inference engine

The layout chain (constraints -> candidate derivation -> placement -> render/export)
lives in `src/layout/` as a standalone, offline-verifiable module:

- `src/layout/types.ts` — block/constraint/placement model and result types.
- `src/layout/validate.ts` — structural validation: constraint cycles and missing
  references are reported as explicit `unsatisfiable` issues naming the involved
  blocks and constraints, never silently skipped.
- `src/layout/solver.ts` — deterministic placement solver (canonical block order,
  lexicographic candidate order). Rotation/alignment at boundary sizes (exact edge
  fit, range overflow, zero-size blocks) yields deterministic accept/reject
  conclusions; nothing is silently clamped.
- `src/layout/incremental.ts` — `LayoutEngine.update(patch)` re-derives only the
  affected suffix of the canonical order; unaffected blocks keep their exact
  placements. Every incremental result is cross-checked against a full re-solve
  (`consistentWithFullSolve`). A block whose candidates are blocked by two or more
  mutex constraints keeps both parties in `conflicts` for manual adjudication;
  adjudicating via `waiveMutex`/`enforceMutex` re-derives only affected blocks.
- `src/layout/render.ts` — offline SVG rendering and JSON export.

Batch verification entry (no browser, no network):

```sh
npm run verify
```

It covers constraint cycles, missing references, mutex multi-hit adjudication,
incremental-vs-full consistency, boundary sizes, determinism, and offline
render/export.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
