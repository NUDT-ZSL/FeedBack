import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

app.post('/api/generate-sprite', upload.array('svgs', 20), async (req, res) => {
  try {
    const { scale = '1x', padding = 0, order = '[]', names = '{}' } = req.body;
    const scaleFactor = scale === '3x' ? 3 : scale === '2x' ? 2 : 1;
    // padding 按逻辑像素（1x 口径）传入，参与拼接时随倍率放大
    const paddingValue = Math.max(0, parseInt(padding, 10) || 0);
    const scaledPadding = paddingValue * scaleFactor;

    let orderArr = [];
    try { orderArr = JSON.parse(order); } catch { orderArr = []; }
    let nameMap = {};
    try { nameMap = JSON.parse(names); } catch { nameMap = {}; }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未上传文件' });
    }

    // 上传阶段前端已为每个图标生成稳定唯一的 id，并以 <id>.svg 作为文件名上传
    const filesById = new Map();
    for (const f of req.files) {
      const id = f.originalname.replace(/\.svg$/i, '');
      if (!filesById.has(id)) filesById.set(id, f);
    }

    // 按 order 中的 id 重排；未匹配到的 id 记入 ignored 并跳过，不影响整体生成
    const ignored = [];
    let orderedFiles;
    if (Array.isArray(orderArr) && orderArr.length > 0) {
      orderedFiles = [];
      const seen = new Set();
      for (const id of orderArr) {
        if (seen.has(id)) continue;
        seen.add(id);
        const file = filesById.get(id);
        if (file) {
          orderedFiles.push({ id, file });
        } else {
          ignored.push(id);
        }
      }
    } else {
      orderedFiles = req.files.map((f) => ({ id: f.originalname.replace(/\.svg$/i, ''), file: f }));
    }

    const processedIcons = [];
    for (const { id, file } of orderedFiles) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        const originalWidth = metadata.width || 24;
        const originalHeight = metadata.height || 24;
        const scaledWidth = originalWidth * scaleFactor;
        const scaledHeight = originalHeight * scaleFactor;
        // 先按放大后的尺寸栅格化，再参与拼接，保证 2x/3x 下图标清晰且尺寸正确
        const resizedBuffer = await sharp(file.buffer, { density: 72 * scaleFactor * 4 })
          .resize(scaledWidth, scaledHeight, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
        processedIcons.push({
          id,
          name: nameMap[id] || id,
          buffer: resizedBuffer,
          width: scaledWidth,
          height: scaledHeight,
          originalWidth,
          originalHeight,
        });
      } catch (e) {
        console.error(`处理 ${file.originalname} 失败:`, e);
      }
    }

    if (processedIcons.length === 0) {
      return res.status(400).json({ error: '无法处理任何SVG文件' });
    }

    // 拼接图按放大后的物理像素排布；间距只出现在相邻图标之间，末尾不多出 padding
    const spriteHeight = Math.max(...processedIcons.map((i) => i.height));
    const totalWidth =
      processedIcons.reduce((sum, icon) => sum + icon.width, 0) +
      scaledPadding * (processedIcons.length - 1);

    let xOffset = 0;
    const iconPositions = [];
    const compositeArray = [];

    for (const icon of processedIcons) {
      iconPositions.push({
        id: icon.id,
        name: icon.name,
        width: icon.width,
        height: icon.height,
        originalWidth: icon.originalWidth,
        originalHeight: icon.originalHeight,
        x: xOffset,
        y: 0,
      });
      compositeArray.push({
        input: icon.buffer,
        left: xOffset,
        top: 0,
      });
      xOffset += icon.width + scaledPadding;
    }

    const spriteId = uuidv4();
    const spritePath = path.join(__dirname, 'uploads', `${spriteId}.png`);

    await sharp({
      create: {
        width: Math.max(totalWidth, 1),
        height: Math.max(spriteHeight, 1),
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(compositeArray)
      .png()
      .toFile(spritePath);

    // CSS 统一使用逻辑像素（1x 口径）：类的宽高、background-position、background-size
    // 均为物理像素 / scaleFactor，渲染时整图等比缩放，与拼接图位置一一对应
    const usedClassNames = new Map();
    const toClassName = (name) => {
      const base = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'icon';
      const count = usedClassNames.get(base) || 0;
      usedClassNames.set(base, count + 1);
      return count === 0 ? base : `${base}-${count + 1}`;
    };

    const cssMappings = iconPositions.map((pos) => {
      const logicalX = pos.x / scaleFactor;
      const logicalY = pos.y / scaleFactor;
      const bgX = logicalX === 0 ? '0' : `-${logicalX}px`;
      const bgY = logicalY === 0 ? '0' : `-${logicalY}px`;
      return {
        id: pos.id,
        name: pos.name,
        className: toClassName(pos.name),
        width: pos.originalWidth,
        height: pos.originalHeight,
        scaledWidth: pos.width,
        scaledHeight: pos.height,
        x: pos.x,
        y: pos.y,
        backgroundPosition: `${bgX} ${bgY}`,
      };
    });

    const logicalWidth = totalWidth / scaleFactor;
    const logicalHeight = spriteHeight / scaleFactor;

    let cssCode = `/* SVG Sprite - Generated ${scale} */\n`;
    cssCode += `.sprite {\n  display: inline-block;\n  background-image: url('sprite.png');\n  background-repeat: no-repeat;\n  background-size: ${logicalWidth}px ${logicalHeight}px;\n}\n\n`;
    cssMappings.forEach((m) => {
      cssCode += `.sprite-${m.className} {\n`;
      cssCode += `  width: ${m.width}px;\n`;
      cssCode += `  height: ${m.height}px;\n`;
      cssCode += `  background-position: ${m.backgroundPosition};\n`;
      cssCode += `}\n\n`;
    });

    res.json({
      spriteId,
      spriteUrl: `/uploads/${spriteId}.png`,
      totalWidth,
      spriteHeight,
      logicalWidth,
      logicalHeight,
      scale,
      scaleFactor,
      padding: paddingValue,
      cssCode,
      mappings: cssMappings,
      ignored,
    });
  } catch (error) {
    console.error('生成雪碧图失败:', error);
    res.status(500).json({ error: '生成雪碧图失败: ' + error.message });
  }
});

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: '文件不存在' });
  }
});

app.listen(PORT, () => {
  console.log(`Sprite server running on http://localhost:${PORT}`);
});
