import type { GradientEngine } from './GradientEngine';

export interface TextStyle {
  content: string;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontWeight: number;
}

export interface CardTemplateData {
  id: string;
  name: string;
  width: number;
  height: number;
  previewRatio: string;
  title: TextStyle;
  subtitle: TextStyle;
  hasDecoration: boolean;
}

export interface CardLayout {
  templateId: string;
  title: TextStyle;
  subtitle: TextStyle;
}

export const CARD_TEMPLATES: CardTemplateData[] = [
  {
    id: 'square-card',
    name: '方形名片',
    width: 400,
    height: 400,
    previewRatio: '1 / 1',
    title: {
      content: 'Hello World',
      fontSize: 36,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: '欢迎使用渐变卡片设计工具',
      fontSize: 14,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
    hasDecoration: true,
  },
  {
    id: 'wide-poster',
    name: '宽屏海报',
    width: 800,
    height: 450,
    previewRatio: '16 / 9',
    title: {
      content: '创意无限',
      fontSize: 56,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: 'DESIGN YOUR IDEA · 2025',
      fontSize: 16,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 500,
    },
    hasDecoration: true,
  },
  {
    id: 'phone-wallpaper',
    name: '手机壁纸',
    width: 360,
    height: 640,
    previewRatio: '9 / 16',
    title: {
      content: 'Good Day',
      fontSize: 48,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 600,
    },
    subtitle: {
      content: 'JUNE 21 · 星期六',
      fontSize: 14,
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
    hasDecoration: false,
  },
  {
    id: 'social-cover',
    name: '社交媒体封面',
    width: 820,
    height: 312,
    previewRatio: '82 / 31.2',
    title: {
      content: 'GRADIENT STUDIO',
      fontSize: 48,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: 'Create Beautiful Cards Effortlessly',
      fontSize: 16,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
    hasDecoration: true,
  },
  {
    id: 'story-portrait',
    name: '竖版故事卡片',
    width: 420,
    height: 720,
    previewRatio: '7 / 12',
    title: {
      content: '今日心情',
      fontSize: 52,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: 'Sunset Vibes 🌅',
      fontSize: 18,
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
    hasDecoration: false,
  },
  {
    id: 'business-card',
    name: '商务名片',
    width: 540,
    height: 320,
    previewRatio: '27 / 16',
    title: {
      content: 'Alex Chen',
      fontSize: 38,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 600,
    },
    subtitle: {
      content: 'Product Designer · hello@alex.design',
      fontSize: 13,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 400,
    },
    hasDecoration: true,
  },
  {
    id: 'square-social',
    name: '方形社交帖',
    width: 500,
    height: 500,
    previewRatio: '1 / 1',
    title: {
      content: 'NEW DROP',
      fontSize: 60,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: '#LimitedEdition · AVAILABLE NOW',
      fontSize: 13,
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 500,
    },
    hasDecoration: true,
  },
  {
    id: 'banner-horizontal',
    name: '横版Banner',
    width: 900,
    height: 250,
    previewRatio: '18 / 5',
    title: {
      content: 'SUMMER SALE',
      fontSize: 56,
      color: '#ffffff',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 700,
    },
    subtitle: {
      content: 'UP TO 50% OFF · JUN 21 - JUL 05',
      fontSize: 14,
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Poppins, Noto Sans SC, sans-serif',
      fontWeight: 500,
    },
    hasDecoration: false,
  },
];

export class CardTemplate {
  static getTemplate(id: string): CardTemplateData {
    return (
      CARD_TEMPLATES.find(t => t.id === id) || CARD_TEMPLATES[0]
    );
  }

  static createLayoutFromTemplate(templateId: string): CardLayout {
    const tpl = CardTemplate.getTemplate(templateId);
    return {
      templateId,
      title: { ...tpl.title },
      subtitle: { ...tpl.subtitle },
    };
  }

  static generateCardContent(
    width: number,
    height: number,
    layout: CardLayout,
    gradientId: string = 'cardGradient'
  ): string {
    const tpl = CardTemplate.getTemplate(layout.templateId);
    const { title, subtitle } = layout;

    const titleY = height * 0.5;
    const subtitleY = titleY + title.fontSize * 0.9 + 16;

    let decoration = '';
    if (tpl.hasDecoration) {
      const lineY = titleY - title.fontSize * 0.7;
      decoration = `
        <rect x="${width * 0.08}" y="${lineY}" width="60" height="4" rx="2" fill="rgba(255,255,255,0.9)" />
        <line x1="${width * 0.08}" y1="${subtitleY + 24}" x2="${width * 0.08 + 40}" y2="${subtitleY + 24}" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" />
      `;
    }

    return `
      <rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" rx="0" ry="0" />
      ${decoration}
      <text
        x="${width * 0.08}"
        y="${titleY}"
        font-family="'${title.fontFamily}'"
        font-size="${title.fontSize}"
        font-weight="${title.fontWeight}"
        fill="${title.color}"
        dominant-baseline="middle"
      >${this.escapeText(title.content)}</text>
      <text
        x="${width * 0.08}"
        y="${subtitleY}"
        font-family="'${subtitle.fontFamily}'"
        font-size="${subtitle.fontSize}"
        font-weight="${subtitle.fontWeight}"
        fill="${subtitle.color}"
        dominant-baseline="middle"
        letter-spacing="0.05em"
      >${this.escapeText(subtitle.content)}</text>
    `;
  }

  static generateFullSVG(
    gradientEngine: GradientEngine,
    layout: CardLayout
  ): string {
    const tpl = CardTemplate.getTemplate(layout.templateId);
    const gradientDef = gradientEngine.generateGradientDef('cardGradient');
    const content = CardTemplate.generateCardContent(
      tpl.width,
      tpl.height,
      layout,
      'cardGradient'
    );

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tpl.width} ${tpl.height}" width="${tpl.width}" height="${tpl.height}">
  <defs>
    ${gradientDef}
  </defs>
  ${content}
</svg>`;
  }

  private static escapeText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
