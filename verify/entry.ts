import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});

const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
g.IS_REACT_ACT_ENVIRONMENT = true;

const { run } = await import('./scenarios');
run()
  .then((ok) => {
    console.log(ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED');
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error('VERIFY ERROR:', err);
    process.exit(1);
  });
