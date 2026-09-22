// 引擎冒烟测试:用 DOM 桩加载 app.js,验证判定/裁切/折中逻辑
const fs = require("fs");

const elemStub = () => ({
  innerHTML: "", textContent: "", value: "", open: false, style: {},
  dataset: {}, checked: false,
  addEventListener() {}, appendChild() {}, reset() {}, click() {},
  querySelector() { return elemStub(); },
  closest() { return null; },
  getContext() {
    return new Proxy({}, { get: (t, k) => {
      if (k === "createLinearGradient") return () => ({ addColorStop() {} });
      return () => {};
    }, set: () => true });
  },
});
global.document = {
  getElementById: () => elemStub(),
  createElement: () => elemStub(),
};
global.localStorage = { getItem: () => null, setItem() {} };
global.alert = () => {}; global.confirm = () => true;

eval(fs.readFileSync("app.js", "utf8") +
  "\n;globalThis.evaluate = evaluate; globalThis.compromisePlan = compromisePlan;" +
  "globalThis.containsRect = containsRect;");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name); }
}

const poster = { id: "a1", name: "海报", tags: [], width: 3000, height: 2000,
  format: "jpg", crop: { x: 0, y: 0, w: 3000, h: 2000 },
  key: { x: 900, y: 500, w: 1200, h: 1000 } };
const product = { id: "a2", name: "产品图", tags: [], width: 2400, height: 2400,
  format: "png", crop: { x: 100, y: 100, w: 2200, h: 2200 },
  key: { x: 600, y: 600, w: 1200, h: 1200 } };
const illu = { id: "a3", name: "插画", tags: [], width: 1600, height: 1600,
  format: "webp", crop: { x: 0, y: 0, w: 1600, h: 1600 },
  key: { x: 300, y: 300, w: 1000, h: 1000 } };

const wechat = { id: "c1", name: "公众号", width: 900, height: 383, margin: 40,
  formats: ["jpg", "png"] };
const shop = { id: "c2", name: "电商", width: 750, height: 750, margin: 20,
  formats: ["jpg", "png", "webp", "gif"] };
const billboard = { id: "c3", name: "大屏", width: 3840, height: 1080, margin: 80,
  formats: ["jpg"] };

// 1. 比例不符 -> 需裁切,方案比例正确且尺寸达标
let ev = evaluate(poster, wechat);
check("海报->公众号 需裁切", ev.status === "crop");
check("裁切比例≈2.349", Math.abs(ev.plan.w / ev.plan.h - 900 / 383) < 0.01);
check("裁切尺寸达标", ev.plan.w >= 900 && ev.plan.h >= 383);
check("裁切框在可裁切区域内", containsRect(poster.crop, ev.plan));
check("关键区域保留在安全区", containsRect(ev.safeArea, poster.key));

// 2. 格式不符 -> 不可适配
ev = evaluate(illu, billboard);
check("webp->仅jpg渠道 不可适配", ev.status === "fail");
check("原因含格式", ev.reasons.some(r => r.includes("格式")));

// 3. 尺寸不足 -> 不可适配
ev = evaluate(product, billboard);
check("产品图->大屏 尺寸不足", ev.status === "fail");
check("原因含尺寸", ev.reasons.some(r => r.includes("尺寸不足")));

// 4. 比例一致且尺寸足够 -> 可适配
const square = { id: "c4", name: "方图", width: 1000, height: 1000, margin: 0,
  formats: ["png"] };
ev = evaluate(product, square);
check("产品图->方图渠道 可适配", ev.status === "ok");

// 5. 边距过大导致关键区域丢失 -> 给出警告
const tight = { id: "c5", name: "紧边距", width: 1000, height: 1000, margin: 400,
  formats: ["png"] };
ev = evaluate(product, tight);
check("过大边距触发关键区域警告", ev.keyLost === true &&
  ev.reasons.some(r => r.includes("边距")));

// 6. 多渠道折中:共享区域存在,各渠道有结论
const cp = compromisePlan(poster, [wechat, shop]);
check("折中方案生成共享区", !!cp.shared && cp.shared.w > 0);
check("每个渠道都有结论行", cp.rows.length === 2);
check("公众号在折中方案中可满足", cp.rows.find(r => r.ch.id === "c1").ok === true);

// 7. 折中方案中无法满足的渠道被标注原因
const cp2 = compromisePlan(illu, [shop, billboard]);
const rowB = cp2.rows.find(r => r.ch.id === "c3");
check("插画->大屏在折中方案中标注失败原因", rowB.ok === false && rowB.reason.length > 0);

// 8. 参数变化即时反映:同一素材,渠道改尺寸后结论同步变化
const before = evaluate(product, billboard).status;
const smaller = Object.assign({}, billboard, { width: 1500, height: 500, formats: ["png"] });
const after = evaluate(product, smaller).status;
check("渠道规格修改后结论重算", before === "fail" && after !== "fail");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
