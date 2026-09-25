import fs from 'fs';
import sharp from 'sharp';

const BASE = 'http://localhost:3001';
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

// 模拟前端上传阶段生成的稳定唯一 id
const mkId = (name) => `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function generate(items, { scale = '1x', padding = 0, order } = {}) {
  const formData = new FormData();
  for (const it of items) {
    const buf = fs.readFileSync(it.path);
    formData.append('svgs', new Blob([buf], { type: 'image/svg+xml' }), `${it.id}.svg`);
  }
  formData.append('scale', scale);
  formData.append('padding', String(padding));
  formData.append('order', JSON.stringify(order ?? items.map((i) => i.id)));
  formData.append('names', JSON.stringify(Object.fromEntries(items.map((i) => [i.id, i.name]))));
  const res = await fetch(`${BASE}/api/generate-sprite`, { method: 'POST', body: formData });
  return { status: res.status, data: await res.json() };
}

// 两个目录下的同名图标 star（尺寸/内容不同）
const starA = { id: mkId('star'), name: 'star', path: './test-icons/dirA/star.svg', w: 24, h: 24 };
const starB = { id: mkId('star'), name: 'star', path: './test-icons/dirB/star.svg', w: 32, h: 32 };
const home = { id: mkId('home'), name: 'home', path: './test-icons/home.svg', w: 24, h: 24 };
const heart = { id: mkId('heart'), name: 'heart', path: './test-icons/heart.svg', w: 24, h: 24 };
const icons = [starA, home, starB, heart];
// 模拟拖拽重排：starB 提到最前，starA 放到最后
const dragOrder = [starB.id, home.id, heart.id, starA.id];
const byId = Object.fromEntries(icons.map((i) => [i.id, i]));

console.log('--- 1. 同名图标 + 拖拽重排 (1x, padding=0) ---');
{
  const { status, data } = await generate(icons, { scale: '1x', padding: 0, order: dragOrder });
  check(status === 200, `生成成功 (status=${status})`);
  check(data.mappings.length === 4, `映射数量=4 (实际 ${data.mappings.length})`);
  check(JSON.stringify(data.mappings.map((m) => m.id)) === JSON.stringify(dragOrder), '映射顺序与拖拽顺序一致');
  const starMappings = data.mappings.filter((m) => m.name === 'star');
  check(starMappings.length === 2, '两个同名 star 都保留，无丢失');
  check(new Set(data.mappings.map((m) => m.className)).size === 4, `类名唯一 (${data.mappings.map((m) => m.className).join(', ')})`);
  check(data.mappings[0].width === 32 && data.mappings[3].width === 24, 'starB(32px) 在首位, starA(24px) 在末位，各自独立占位');
  check(data.ignored.length === 0, '无被忽略项');
  const expectedWidth = 32 + 24 + 24 + 24;
  check(data.totalWidth === expectedWidth, `padding=0 总宽=${expectedWidth} (实际 ${data.totalWidth})`);
  const last = data.mappings[3];
  check(last.x + last.scaledWidth === data.totalWidth, '最后一个图标后无多余 padding');
}

console.log('--- 2. 多倍图 CSS 口径 (1x/2x/3x, padding=5) ---');
for (const scale of ['1x', '2x', '3x']) {
  const sf = scale === '3x' ? 3 : scale === '2x' ? 2 : 1;
  const { status, data } = await generate(icons, { scale, padding: 5, order: dragOrder });
  check(status === 200, `${scale} 生成成功`);
  const sumW = icons.reduce((s, i) => s + i.w * sf, 0);
  const expectedWidth = sumW + 5 * sf * (icons.length - 1);
  check(data.totalWidth === expectedWidth, `${scale} padding=5 总宽=${expectedWidth} (实际 ${data.totalWidth})`);
  const pngBuf = Buffer.from(await (await fetch(`${BASE}${data.spriteUrl}`)).arrayBuffer());
  const meta = await sharp(pngBuf).metadata();
  check(meta.width === data.totalWidth && meta.height === data.spriteHeight, `${scale} PNG 尺寸=${data.totalWidth}x${data.spriteHeight}`);
  check(data.logicalWidth === data.totalWidth / sf && data.logicalHeight === data.spriteHeight / sf, `${scale} 逻辑尺寸=物理/倍率`);
  check(data.cssCode.includes(`background-size: ${data.logicalWidth}px ${data.logicalHeight}px;`), `${scale} background-size 按整图逻辑尺寸`);
  let prevEnd = 0;
  for (const m of data.mappings) {
    const src = byId[m.id];
    const okSize = m.width === src.w && m.height === src.h;
    const okPos = m.x === prevEnd && m.backgroundPosition === (m.x === 0 ? '0 0' : `-${m.x / sf}px 0`);
    const okCss = data.cssCode.includes(`.sprite-${m.className} {`) &&
      data.cssCode.includes(`width: ${src.w}px;`) && data.cssCode.includes(`height: ${src.h}px;`);
    check(okSize && okPos && okCss, `${scale} ${m.name}(${m.className}): CSS宽高=${src.w}x${src.h}, 位置=${m.backgroundPosition}`);
    // 像素校验：图标区域有内容
    const region = await sharp(pngBuf)
      .extract({ left: m.x, top: 0, width: m.scaledWidth, height: m.scaledHeight }).raw().toBuffer();
    const hasContent = region.some((v, i) => i % 4 === 3 && v > 0);
    check(hasContent, `${scale} ${m.name} 拼接区域 [x=${m.x}] 有实际像素`);
    prevEnd = m.x + m.scaledWidth + 5 * sf;
  }
  // padding 间隙应全透明
  const gap = await sharp(pngBuf)
    .extract({ left: data.mappings[0].scaledWidth, top: 0, width: 5 * sf, height: data.spriteHeight }).raw().toBuffer();
  check(gap.every((v, i) => i % 4 !== 3 || v === 0), `${scale} 相邻图标间 padding 间隙为透明`);
}

console.log('--- 3. order 含无效标识 ---');
{
  const bogus = ['ghost_id_1', 'ghost_id_2'];
  const { status, data } = await generate(icons, { scale: '2x', padding: 0, order: [starB.id, ...bogus, home.id] });
  check(status === 200, `生成仍成功 (status=${status})`);
  check(JSON.stringify(data.ignored) === JSON.stringify(bogus), `响应标明被忽略项: ${JSON.stringify(data.ignored)}`);
  check(data.mappings.length === 2 && data.mappings[0].id === starB.id && data.mappings[1].id === home.id, '有效项正常生成且顺序正确');
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
