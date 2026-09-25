import fs from 'fs';
import assert from 'assert';
import sharp from 'sharp';

const API = 'http://localhost:3001/api/generate-sprite';
const BASE = 'http://localhost:3001';

// Two distinct icons that share the exact same file name.
const logoA = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#ff0000"/></svg>`;
const logoB = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0000ff"/></svg>`;
const icon = (name) => fs.readFileSync(`./test-icons/${name}`);
const svgBlob = (content) => new Blob([content], { type: 'image/svg+xml' });

async function generate({ scale, padding, files, ids, order }) {
  const form = new FormData();
  files.forEach(({ name, content }) => form.append('svgs', svgBlob(content), name));
  if (ids) form.append('iconIds', JSON.stringify(ids));
  form.append('scale', scale);
  form.append('padding', String(padding));
  form.append('order', JSON.stringify(order));
  const res = await fetch(API, { method: 'POST', body: form });
  assert.equal(res.status, 200, `expected 200 got ${res.status}`);
  return res.json();
}

const rawAt = async (content, w, h) =>
  sharp(Buffer.from(content)).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer();

const downloadPng = async (url) => {
  const res = await fetch(`${BASE}${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
};

const pix = (buf, w, x, y) => buf.slice((y * w + x) * 4, (y * w + x) * 4 + 4);

// Compare a sprite slot against the independently rasterized expected icon.
function slotMatches(sprite, spriteW, slotX, slotY, expected, iw, ih) {
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      const a = pix(sprite, spriteW, slotX + x, slotY + y);
      const b = pix(expected, iw, x, y);
      if (Math.abs(a[3] - b[3]) > 30) return false;
      if (a[3] > 100 && (Math.abs(a[0] - b[0]) > 40 || Math.abs(a[1] - b[1]) > 40 || Math.abs(a[2] - b[2]) > 40)) {
        return false;
      }
    }
  }
  return true;
}

const files = [
  { name: 'logo.svg', content: logoA },
  { name: 'home.svg', content: icon('home.svg') },
  { name: 'logo.svg', content: logoB },
  { name: 'star.svg', content: icon('star.svg') },
  { name: 'search.svg', content: icon('search.svg') },
];
const ids = ['logo-a', 'home', 'logo-b', 'star', 'search'];
// User-dragged order + one unknown id + one duplicated id.
const order = ['logo-b', 'search', 'missing-id', 'logo-a', 'home', 'star', 'logo-b'];
const expectedOrder = ['logo-b', 'search', 'logo-a', 'home', 'star'];
const expectedLayout = [[0, 20], [30, 24], [64, 24], [98, 24], [132, 32]];

for (const scale of ['1x', '2x', '3x']) {
  const s = scale === '3x' ? 3 : scale === '2x' ? 2 : 1;
  const data = await generate({ scale, padding: 10, files, ids, order });

  // Same-named icons stay independent, order follows the drag exactly.
  assert.deepEqual(data.mappings.map((m) => m.id), expectedOrder, `${scale} order`);
  assert.equal(data.mappings.length, 5, `${scale} mapping count`);
  assert.deepEqual(data.mappings.filter((m) => m.name === 'logo').map((m) => m.id), ['logo-b', 'logo-a']);
  const logoClasses = data.mappings.filter((m) => m.name === 'logo').map((m) => m.className);
  assert.equal(new Set(logoClasses).size, 2, `${scale} distinct logo class names`);

  const ignored = data.ignoredOrder.map((i) => i.id);
  assert.ok(ignored.includes('missing-id'), `${scale} missing-id reported`);
  assert.ok(ignored.includes('logo-b'), `${scale} duplicate reported`);

  // Logical widths: 20 + 24*3 + 32 (star) plus 4 gaps of 10 -> 164 logical px.
  assert.equal(data.logicalWidth, 164, `${scale} logicalWidth`);
  assert.equal(data.logicalHeight, 32, `${scale} logicalHeight`);
  assert.equal(data.totalWidth, 164 * s, `${scale} physicalWidth`);
  assert.equal(data.spriteHeight, 32 * s, `${scale} physicalHeight`);
  assert.deepEqual(data.mappings.map((m) => [m.x, m.width]), expectedLayout, `${scale} logical positions`);

  // Every CSS rule uses logical pixels consistently.
  for (let i = 0; i < expectedOrder.length; i++) {
    const [x, width] = expectedLayout[i];
    assert.ok(data.cssCode.includes(`.${data.mappings[i].className} {`), `${scale} class block`);
    assert.ok(data.cssCode.includes(`width: ${width}px`), `${scale} logical width`);
    assert.ok(data.cssCode.includes(`background-position: -${x}px 0`), `${scale} logical position`);
    assert.ok(data.cssCode.includes(`background-size: 164px 32px`), `${scale} logical bg-size`);
  }

  // Pixel-level verification of the generated PNG.
  const { data: png, info } = await downloadPng(data.spriteUrl);
  assert.equal(info.width, 164 * s, `${scale} png width`);
  assert.equal(info.height, 32 * s, `${scale} png height`);

  const specById = {
    'logo-b': { x: 0, w: 20, h: 20, content: logoB, color: [0, 0, 255] },
    search: { x: 30, w: 24, h: 24, content: icon('search.svg') },
    'logo-a': { x: 64, w: 24, h: 24, content: logoA, color: [255, 0, 0] },
    home: { x: 98, w: 24, h: 24, content: icon('home.svg') },
    star: { x: 132, w: 32, h: 32, content: icon('star.svg') },
  };
  for (const m of data.mappings) {
    const spec = specById[m.id];
    const h = spec.h || 24;
    const expected = await rawAt(spec.content, spec.w * s, h * s);
    assert.ok(slotMatches(png, info.width, spec.x * s, 0, expected, spec.w * s, h * s), `${scale} slot ${m.id} pixels`);
    if (spec.color) {
      const [r, g, b, a] = pix(png, info.width, spec.x * s + Math.floor(spec.w * s / 2), Math.floor((spec.h || 24) * s / 2));
      assert.ok(a > 100 && Math.abs(r - spec.color[0]) < 30 && Math.abs(g - spec.color[1]) < 30 && Math.abs(b - spec.color[2]) < 30, `${scale} ${m.id} center color`);
    }
  }

  // Padding gaps are transparent and there is no trailing gap past the last icon.
  for (const gx of [25, 59, 93, 127]) {
    assert.equal(pix(png, info.width, gx * s, 16 * s)[3], 0, `${scale} gap at ${gx} transparent`);
  }
  console.log(`${scale}: OK (${data.mappings.length} icons, ${data.totalWidth}x${data.spriteHeight}, ignored: ${ignored.join(', ')})`);
}

// Padding 0: width is exactly the sum of icon widths and slots are flush.
const tight = await generate({
  scale: '2x', padding: 0,
  files: [{ name: 'logo.svg', content: logoB }, { name: 'logo.svg', content: logoA }],
  ids: ['logo-b', 'logo-a'], order: ['logo-b', 'logo-a'],
});
assert.equal(tight.totalWidth, 88, 'padding 0 width = (20+24)*2');
assert.equal(tight.logicalWidth, 44, 'padding 0 logical width');
assert.deepEqual(tight.mappings.map((m) => m.id), ['logo-b', 'logo-a']);
const { data: tightPng, info: tightInfo } = await downloadPng(tight.spriteUrl);
assert.deepEqual([...pix(tightPng, tightInfo.width, 39, 24)], [0, 0, 255, 255]);
assert.deepEqual([...pix(tightPng, tightInfo.width, 40, 24)], [255, 0, 0, 255]);
console.log('padding=0: OK (88px physical, icons flush)');

// Legacy client sending only bare names keeps working.
const legacy = await generate({
  scale: '1x', padding: 0,
  files: [{ name: 'home.svg', content: icon('home.svg') }, { name: 'star.svg', content: icon('star.svg') }],
  order: ['star', 'home'],
});
assert.deepEqual(legacy.mappings.map((m) => m.name), ['star', 'home']);
console.log('legacy name order: OK');

console.log('\nAll acceptance checks passed.');
