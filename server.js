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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Render a pixel value without floating-point artifacts.
const fmt = (n) => String(Math.round(n * 1000) / 1000);

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

app.post('/api/generate-sprite', upload.array('svgs', 20), async (req, res) => {
  try {
    const { scale = '1x', padding = 0 } = req.body;
    const scaleFactor = scale === '3x' ? 3 : scale === '2x' ? 2 : 1;
    const paddingValue = Math.max(0, parseInt(padding, 10) || 0);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未上传文件' });
    }

    // `iconIds` is sent in the same order as the `svgs` files. Stable unique
    // ids let same-named icons from different folders keep independent slots.
    const rawIconIds = parseJsonField(req.body.iconIds, null);
    const iconIds = Array.isArray(rawIconIds) && rawIconIds.length === req.files.length
      ? rawIconIds.map((id, i) => (typeof id === 'string' && id.trim() ? id : `icon-${i + 1}`))
      : req.files.map((f, i) => `${path.parse(f.originalname).name}-${i + 1}`);

    const uploadedIcons = req.files.map((file, i) => ({
      id: String(iconIds[i]),
      name: path.parse(file.originalname).name,
      originalName: file.originalname,
      buffer: file.buffer,
    }));
    const iconsById = new Map(uploadedIcons.map((icon) => [icon.id, icon]));

    // Reorder strictly by stable id. Unknown/duplicated entries are ignored
    // instead of failing the request and are reported via `ignoredOrder`.
    const parsedOrder = parseJsonField(req.body.order, []);
    const orderList = Array.isArray(parsedOrder) ? parsedOrder : [];
    const orderedIcons = [];
    const ignoredOrder = [];
    const consumedIds = new Set();

    for (const entry of orderList) {
      const id = String(entry ?? '');
      if (!id) {
        ignoredOrder.push({ id, reason: 'empty' });
        continue;
      }
      if (consumedIds.has(id)) {
        ignoredOrder.push({ id, reason: 'duplicate' });
        continue;
      }
      const icon = iconsById.get(id);
      if (icon) {
        consumedIds.add(id);
        orderedIcons.push(icon);
        continue;
      }
      // Backward compatibility: legacy clients sent bare icon names.
      const legacyIcon = uploadedIcons.find((it) => !consumedIds.has(it.id) && it.name === id);
      if (legacyIcon) {
        consumedIds.add(legacyIcon.id);
        orderedIcons.push(legacyIcon);
      } else {
        ignoredOrder.push({ id, reason: 'not-found' });
      }
    }

    // Icons missing from `order` keep their original upload position.
    for (const icon of uploadedIcons) {
      if (!consumedIds.has(icon.id)) orderedIcons.push(icon);
    }

    const processedIcons = [];
    for (const icon of orderedIcons) {
      try {
        const metadata = await sharp(icon.buffer).metadata();
        const logicalWidth = metadata.width || 0;
        const logicalHeight = metadata.height || 0;
        processedIcons.push({
          ...icon,
          logicalWidth,
          logicalHeight,
          physicalWidth: logicalWidth * scaleFactor,
          physicalHeight: logicalHeight * scaleFactor,
        });
      } catch (e) {
        console.error(`处理 ${icon.originalName} 失败:`, e);
      }
    }

    if (processedIcons.length === 0) {
      return res.status(400).json({ error: '无法处理任何SVG文件' });
    }

    // Padding is part of the physical PNG and scales like the icons. All CSS
    // coordinates/sizes below are expressed in logical (1x) pixels.
    const physicalPadding = paddingValue * scaleFactor;
    const physicalHeight = Math.max(...processedIcons.map((i) => i.physicalHeight));
    const physicalWidth = processedIcons.reduce(
      (sum, icon) => sum + icon.physicalWidth + physicalPadding,
      -physicalPadding
    );
    const logicalWidth = physicalWidth / scaleFactor;
    const logicalHeight = physicalHeight / scaleFactor;

    // Resolve class-name collisions so same-named icons remain independently
    // addressable in the generated stylesheet.
    const nameCounts = new Map();
    for (const icon of processedIcons) {
      nameCounts.set(icon.name, (nameCounts.get(icon.name) || 0) + 1);
    }
    const seenNames = new Map();

    let physicalX = 0;
    const compositeArray = [];
    const cssMappings = [];

    for (const icon of processedIcons) {
      const seen = seenNames.get(icon.name) || 0;
      seenNames.set(icon.name, seen + 1);
      const baseClass = `sprite-${icon.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const className = nameCounts.get(icon.name) > 1 ? `${baseClass}-${seen + 1}` : baseClass;

      const logicalX = physicalX / scaleFactor;
      // Rasterize the SVG at physical pixels first; composite's resize does
      // not upscale vector inputs reliably across sharp versions.
      const raster = await sharp(icon.buffer)
        .resize(icon.physicalWidth, icon.physicalHeight, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      compositeArray.push({
        input: raster,
        left: physicalX,
        top: 0,
      });
      cssMappings.push({
        id: icon.id,
        name: icon.name,
        originalName: icon.originalName,
        className,
        width: icon.logicalWidth,
        height: icon.logicalHeight,
        physicalWidth: icon.physicalWidth,
        physicalHeight: icon.physicalHeight,
        x: logicalX,
        y: 0,
        backgroundPosition: `-${fmt(logicalX)}px 0`,
      });
      physicalX += icon.physicalWidth + physicalPadding;
    }

    const spriteId = uuidv4();
    const spritePath = path.join(uploadsDir, `${spriteId}.png`);

    await sharp({
      create: {
        width: Math.max(physicalWidth, 1),
        height: Math.max(physicalHeight, 1),
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(compositeArray)
      .png()
      .toFile(spritePath);

    // Single source of truth: every CSS value (size, position, background-size)
    // is expressed in logical pixels. The browser then downsamples the @Nx PNG
    // via background-size, so 1x/2x/3x render identically without stretching.
    let cssCode = `/* SVG Sprite - Generated ${scale} */\n`;
    cssCode += `.sprite {\n  display: inline-block;\n  background-image: url('sprite.png');\n  background-repeat: no-repeat;\n`;
    cssCode += `  background-size: ${fmt(logicalWidth)}px ${fmt(logicalHeight)}px;\n}\n\n`;
    cssMappings.forEach((m) => {
      cssCode += `.${m.className} {\n`;
      cssCode += `  width: ${fmt(m.width)}px;\n`;
      cssCode += `  height: ${fmt(m.height)}px;\n`;
      cssCode += `  background-position: ${m.backgroundPosition};\n`;
      cssCode += `  background-size: ${fmt(logicalWidth)}px ${fmt(logicalHeight)}px;\n`;
      cssCode += `}\n\n`;
    });

    res.json({
      spriteId,
      spriteUrl: `/uploads/${spriteId}.png`,
      totalWidth: physicalWidth,
      spriteHeight: physicalHeight,
      logicalWidth,
      logicalHeight,
      scale,
      scaleFactor,
      padding: paddingValue,
      cssCode,
      mappings: cssMappings,
      ignoredOrder,
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
