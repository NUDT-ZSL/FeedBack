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
    const { scale = '1x', padding = 0, order = '[]' } = req.body;
    const scaleFactor = scale === '3x' ? 3 : scale === '2x' ? 2 : 1;
    const paddingValue = parseInt(padding) || 0;
    const orderArr = JSON.parse(order);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未上传文件' });
    }

    const files = orderArr.length > 0
      ? orderArr.map(id => req.files.find(f => f.originalname.replace(/\.svg$/i, '') === id) || req.files.find(f => f.originalname === id)).filter(Boolean)
      : req.files;

    const processedIcons = [];
    for (const file of files) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        processedIcons.push({
          name: file.originalname.replace(/\.svg$/i, ''),
          originalName: file.originalname,
          buffer: file.buffer,
          width: width * scaleFactor,
          height: height * scaleFactor,
          originalWidth: width,
          originalHeight: height,
        });
      } catch (e) {
        console.error(`处理 ${file.originalname} 失败:`, e);
      }
    }

    if (processedIcons.length === 0) {
      return res.status(400).json({ error: '无法处理任何SVG文件' });
    }

    const maxWidth = Math.max(...processedIcons.map(i => i.width));
    const maxHeight = Math.max(...processedIcons.map(i => i.height));
    const totalWidth = processedIcons.reduce((sum, icon) => sum + icon.width + paddingValue, 0) - paddingValue;
    const spriteHeight = maxHeight;

    let xOffset = 0;
    const iconPositions = [];
    const compositeArray = [];

    for (const icon of processedIcons) {
      iconPositions.push({
        name: icon.name,
        originalName: icon.originalName,
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
        resize: { width: icon.width, height: icon.height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } },
      });
      xOffset += icon.width + paddingValue;
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

    const cssMappings = iconPositions.map(pos => {
      const bgX = pos.x === 0 ? '0' : `-${pos.x}px`;
      const bgY = pos.y === 0 ? '0' : `-${pos.y}px`;
      return {
        name: pos.name,
        originalName: pos.originalName,
        width: pos.width,
        height: pos.height,
        originalWidth: pos.originalWidth,
        originalHeight: pos.originalHeight,
        x: pos.x,
        y: pos.y,
        backgroundPosition: `${bgX} ${bgY}`,
      };
    });

    let cssCode = `/* SVG Sprite - Generated ${scale} */\n`;
    cssCode += `.sprite {\n  display: inline-block;\n  background-image: url('sprite.png');\n  background-repeat: no-repeat;\n}\n\n`;
    cssMappings.forEach(m => {
      const className = m.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      cssCode += `.sprite-${className} {\n`;
      cssCode += `  width: ${m.originalWidth}px;\n`;
      cssCode += `  height: ${m.originalHeight}px;\n`;
      cssCode += `  background-position: ${m.backgroundPosition};\n`;
      if (scaleFactor !== 1) {
        cssCode += `  background-size: ${totalWidth / scaleFactor}px auto;\n`;
      }
      cssCode += `}\n\n`;
    });

    res.json({
      spriteId,
      spriteUrl: `/uploads/${spriteId}.png`,
      totalWidth,
      spriteHeight,
      scale,
      scaleFactor,
      padding: paddingValue,
      cssCode,
      mappings: cssMappings,
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
