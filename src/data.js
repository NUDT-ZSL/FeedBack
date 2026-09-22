export const initialAssets = [
  {
    id: "hero-visual",
    name: "品牌主视觉-横版",
    tags: ["官网", "横幅", "主视觉"],
    width: 3000,
    height: 2000,
    format: "PNG",
    allowedCrop: { x: 120, y: 80, w: 2760, h: 1840 },
    keyAreas: [
      { x: 720, y: 620, w: 900, h: 720, label: "人物" },
      { x: 380, y: 240, w: 760, h: 180, label: "品牌标题" }
    ],
    notes: "人物面部和左侧标题需要保留。"
  },
  {
    id: "product-square",
    name: "产品静物-方图",
    tags: ["电商", "产品", "社交"],
    width: 2400,
    height: 2400,
    format: "JPG",
    allowedCrop: { x: 180, y: 100, w: 2050, h: 2200 },
    keyAreas: [
      { x: 620, y: 520, w: 1020, h: 1280, label: "产品主体" }
    ]
  },
  {
    id: "vertical-story",
    name: "活动海报-竖版",
    tags: ["Story", "活动", "移动端"],
    width: 1500,
    height: 2668,
    format: "PNG",
    allowedCrop: { x: 60, y: 0, w: 1380, h: 2628 },
    keyAreas: [
      { x: 390, y: 420, w: 720, h: 320, label: "主标题" },
      { x: 350, y: 1000, w: 800, h: 760, label: "产品组合" }
    ]
  },
  {
    id: "small-banner",
    name: "旧版运营小横幅",
    tags: ["邮件", "横幅", "历史素材"],
    width: 1080,
    height: 430,
    format: "GIF",
    allowedCrop: { x: 0, y: 0, w: 1080, h: 430 },
    keyAreas: [
      { x: 80, y: 80, w: 900, h: 260, label: "文案和产品" }
    ],
    notes: "分辨率偏低，仅可用于低规格渠道。"
  },
  {
    id: "app-icon-render",
    name: "App 图标渲染",
    tags: ["应用商店", "图标"],
    width: 2048,
    height: 2048,
    format: "WEBP",
    allowedCrop: { x: 180, y: 180, w: 1688, h: 1688 },
    keyAreas: [
      { x: 520, y: 420, w: 1000, h: 1100, label: "图标主体" }
    ]
  }
];

export const initialChannels = [
  {
    id: "website-hero",
    name: "官网首页横幅",
    targetWidth: 1920,
    targetHeight: 1005,
    safeMargin: { top: 8, right: 10, bottom: 8, left: 10 },
    acceptedFormats: ["JPG", "WEBP"],
    maxFileSizeMB: 3
  },
  {
    id: "social-square",
    name: "社交方图",
    targetWidth: 1080,
    targetHeight: 1080,
    safeMargin: { top: 12, right: 12, bottom: 12, left: 12 },
    acceptedFormats: ["JPG", "PNG"],
    maxFileSizeMB: 2
  },
  {
    id: "story-vertical",
    name: "Story 竖版",
    targetWidth: 1080,
    targetHeight: 1920,
    safeMargin: { top: 18, right: 10, bottom: 18, left: 10 },
    acceptedFormats: ["JPG", "PNG"],
    maxFileSizeMB: 2
  },
  {
    id: "email-banner",
    name: "邮件横幅",
    targetWidth: 1200,
    targetHeight: 628,
    safeMargin: { top: 6, right: 8, bottom: 6, left: 8 },
    acceptedFormats: ["PNG", "JPG"],
    maxFileSizeMB: 1
  },
  {
    id: "store-icon",
    name: "应用商店图标",
    targetWidth: 1024,
    targetHeight: 1024,
    safeMargin: { top: 10, right: 10, bottom: 10, left: 10 },
    acceptedFormats: ["PNG"],
    maxFileSizeMB: 1
  }
];
