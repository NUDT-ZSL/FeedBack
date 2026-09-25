# Offline verification suite

Reproducible, browser-free checks for the full ball pipeline:
strike -> terrain friction/slope -> fence bounce -> hole capture ->
stroke counting -> win/fail state.

## Run

```
npm run verify        # or: node verify/run.ts
```

Requires Node >= 22.18 (runs the TypeScript sources directly, no build
step). Exit code is 0 when every chain passes, 1 otherwise.

## How determinism works

`src/rng.ts` provides a seeded PRNG (mulberry32). `Course` and `Ball`
accept an injected random source (default `Math.random`, so browser
behavior is unchanged). `src/headlessGame.ts` wires seeded streams into
a DOM-free game core that mirrors the stroke/state logic of `main.ts`
and shares its constants via `src/rules.ts`. Same seed + same shots =>
same course, same trajectory, same final state.

## Chains and what they pin

- `terrain`  - seeded course layout reproducibility; grass/sand/uphill/
  downhill speed decay; seeded slope deviation (stable per seed).
- `fence`    - reflection direction, energy damping, push-out, and that
  the ball never escapes the fence loop.
- `hole`     - the capture rule (speed < 8 or dist < half radius) across
  a speed x distance matrix, including boundary combos.
- `strokes`  - stroke counting, fail at the stroke limit, win on
  capture, strike-while-rolling guard.
- `golden/*` - pinned end-to-end snapshots (final position, hole flag,
  stroke count, game state) per chain. A physics or rules change fails
  exactly the golden scenarios of the affected chain and prints
  expected vs actual values.

## Updating goldens

Goldens in `verify/golden.ts` are behavioral locks, not laws. After an
intentional physics change, replay the scenarios, paste the new values,
and commit both together.
