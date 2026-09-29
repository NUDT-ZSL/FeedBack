// Node module resolution hook: redirects the bare specifier "tinycolor2"
// to the local offline stub so tests can import GradientEngine.ts without
// node_modules or network access.

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'tinycolor2') {
    return {
      url: new URL('./tinycolor2-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
