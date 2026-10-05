import { useMemo, useState } from 'react';
import { createPaletteStore } from './paletteStore.ts';
import type { PaletteStoreOptions, Transition } from './paletteStore.ts';

export function usePaletteStore(options?: PaletteStoreOptions) {
  const [store] = useState(() => createPaletteStore(options));
  const [version, setVersion] = useState(0);

  const actions = useMemo(() => {
    const wrap = <Args extends unknown[]>(fn: (...args: Args) => Transition) =>
      (...args: Args): Transition => {
        const transition = fn(...args);
        setVersion((v) => v + 1);
        return transition;
      };
    return {
      addColor: wrap(store.addColor),
      setHex: wrap(store.setHex),
      setRgb: wrap(store.setRgb),
      setLightness: wrap(store.setLightness),
      setSaturation: wrap(store.setSaturation),
      removeColor: wrap(store.removeColor),
      reorder: wrap(store.reorder),
      applyPreset: wrap(store.applyPreset),
      clearPreset: wrap(store.clearPreset),
      load: wrap(store.load)
    };
  }, [store]);

  void version;
  return {
    state: store.getState(),
    derived: store.getDerived(),
    transitions: store.getTransitions(),
    serialize: store.serialize,
    ...actions
  };
}
