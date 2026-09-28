import type { ImageryElement, ImageryMatch, PoemData } from '../types';

const traditionalToSimplifiedMap: Record<string, string> = {
  '月': '月', '明': '明', '燈': '灯', '風': '风', '雨': '雨', '雪': '雪',
  '霜': '霜', '露': '露', '雲': '云', '雷': '雷', '電': '电', '山': '山',
  '水': '水', '河': '河', '江': '江', '湖': '湖', '海': '海', '溪': '溪',
  '泉': '泉', '石': '石', '巖': '岩', '峰': '峰', '嶺': '岭', '島': '岛',
  '樹': '树', '木': '木', '花': '花', '草': '草', '葉': '叶', '枝': '枝',
  '根': '根', '林': '林', '森': '森', '竹': '竹', '松': '松', '梅': '梅',
  '蘭': '兰', '菊': '菊', '荷': '荷', '桃': '桃', '柳': '柳', '楓': '枫',
  '杏': '杏', '梨': '梨', '櫻': '樱', '蓮': '莲', '蘆': '芦', '葦': '苇',
  '鳥': '鸟', '鷺': '鹭', '鷹': '鹰', '雁': '雁', '燕': '燕', '鵲': '鹊',
  '鴉': '鸦', '鶴': '鹤', '鴛': '鸳', '鴦': '鸯', '蝶': '蝶', '蟬': '蝉',
  '蜂': '蜂', '螢': '萤', '魚': '鱼', '龍': '龙', '馬': '马', '牛': '牛',
  '舟': '舟', '船': '船', '帆': '帆', '橋': '桥', '樓': '楼', '閣': '阁',
  '亭': '亭', '臺': '台', '塔': '塔', '廟': '庙', '寺': '寺', '觀': '观',
  '門': '门', '窗': '窗', '牆': '墙', '階': '阶', '徑': '径', '路': '路',
  '燭': '烛', '香': '香', '書': '书', '琴': '琴', '棋': '棋', '畫': '画',
  '劍': '剑', '簫': '箫', '笛': '笛', '鐘': '钟', '鼓': '鼓', '鈴': '铃',
  '春': '春', '夏': '夏', '秋': '秋', '冬': '冬', '晨': '晨', '暮': '暮',
  '曉': '晓', '夕': '夕', '夜': '夜', '晝': '昼', '寒': '寒', '暖': '暖',
  '涼': '凉', '熱': '热', '清': '清', '幽': '幽', '閒': '闲', '靜': '静',
  '深': '深', '遠': '远', '高': '高', '低': '低', '長': '长', '短': '短',
  '舊': '旧', '新': '新', '古': '古', '今': '今', '來': '来', '去': '去',
  '歸': '归', '還': '还', '無': '无', '有': '有', '空': '空', '滿': '满',
  '千': '千', '萬': '万', '百': '百', '十': '十', '一': '一', '兩': '两',
  '舉': '举', '抬': '抬', '望': '望', '思': '思', '念': '念',
  '愁': '愁', '歡': '欢', '喜': '喜', '悲': '悲', '恨': '恨', '愛': '爱',
  '憶': '忆', '忘': '忘', '醒': '醒', '醉': '醉', '夢': '梦', '眠': '眠',
  '獨': '独', '孤': '孤', '雙': '双', '對': '对', '相': '相', '共': '共',
  '自': '自', '誰': '谁', '何': '何', '幾': '几', '多': '多', '少': '少',
  '聞': '闻', '見': '见', '看': '看', '聽': '听', '感': '感', '覺': '觉',
  '知': '知', '識': '识', '道': '道', '說': '说', '語': '语', '言': '言',
  '笑': '笑', '哭': '哭', '嘆': '叹', '吟': '吟', '唱': '唱', '彈': '弹',
  '吹': '吹', '寫': '写', '題': '题', '贈': '赠', '寄': '寄',
  '送': '送', '別': '别', '離': '离', '逢': '逢', '遇': '遇',
  '故人': '故人', '明月': '明月', '清风': '清风', '细雨': '细雨',
  '落花': '落花', '流水': '流水', '浮云': '浮云', '落日': '落日',
  '夕阳': '夕阳', '残霞': '残霞', '孤烟': '孤烟', '远钟': '远钟',
  '古寺': '古寺', '深山': '深山', '小径': '小径', '幽篁': '幽篁',
  '翠竹': '翠竹', '青松': '青松', '红梅': '红梅', '白莲': '白莲',
  '黄菊': '黄菊', '紫苔': '紫苔', '碧荷': '碧荷', '金柳': '金柳',
  '银霜': '银霜', '玉露': '玉露', '珍珠': '珍珠', '琉璃': '琉璃',
  '翡翠': '翡翠', '珊瑚': '珊瑚', '玛瑙': '玛瑙', '琥珀': '琥珀',
  '长亭': '长亭', '古道': '古道', '灞桥': '灞桥', '渭城': '渭城',
  '阳关': '阳关', '三叠': '三叠', '一曲': '一曲', '半盏': '半盏',
  '满樽': '满樽', '空杯': '空杯', '余香': '余香', '残墨': '残墨',
  '废卷': '废卷', '断弦': '断弦', '孤灯': '孤灯', '只影': '只影',
  '单衣': '单衣', '薄衾': '薄衾', '寒窗': '寒窗', '冷枕': '冷枕',
  '漏断': '漏断', '更深': '更深', '夜半': '夜半', '五更': '五更',
  '晨曦': '晨曦', '暮色': '暮色', '朝露': '朝露', '晚霞': '晚霞',
  '春水': '春水', '秋月': '秋月', '夏荷': '夏荷', '冬梅': '冬梅',
  '柳絮': '柳絮', '萍踪': '萍踪', '雁阵': '雁阵', '渔舟': '渔舟',
  '樵夫': '樵夫', '钓叟': '钓叟', '牧童': '牧童', '浣女': '浣女',
  '书生': '书生', '侠客': '侠客', '隐士': '隐士', '谪仙': '谪仙',
  '佳人': '佳人', '君子': '君子', '知己': '知己',
  '天涯': '天涯', '海角': '海角', '他乡': '他乡', '故园': '故园',
  '故国': '故国', '神州': '神州', '山河': '山河', '乾坤': '乾坤',
  '天地': '天地', '日月': '日月', '星辰': '星辰', '风云': '风云',
  '江湖': '江湖', '庙堂': '庙堂', '山林': '山林', '市井': '市井',
  '田园': '田园', '边塞': '边塞', '江南': '江南', '塞北': '塞北',
  '长安': '长安', '洛阳': '洛阳', '金陵': '金陵', '成都': '成都',
  '西湖': '西湖', '洞庭': '洞庭', '赤壁': '赤壁', '兰亭': '兰亭',
  '桃李': '桃李', '芝兰': '芝兰', '椿萱': '椿萱', '手足': '手足',
  '比翼': '比翼', '连理': '连理', '并蒂': '并蒂', '同心': '同心',
  '知音': '知音', '丝竹': '丝竹', '管弦': '管弦', '笙歌': '笙歌',
  '吟咏': '吟咏', '唱和': '唱和', '酬答': '酬答', '赠答': '赠答',
  '墨香': '墨香', '书韵': '书韵', '画意': '画意', '诗情': '诗情',
  '雅趣': '雅趣', '幽怀': '幽怀', '逸兴': '逸兴', '豪情': '豪情',
  '壮怀': '壮怀', '愁思': '愁思', '别绪': '别绪', '离情': '离情',
  '乡思': '乡思', '旅愁': '旅愁', '闺怨': '闺怨', '宫愁': '宫愁',
  '春恨': '春恨', '秋悲': '秋悲', '乡愁': '乡愁', '国殇': '国殇',
};

export function traditionalToSimplified(text: string): string {
  let result = text;
  for (const [traditional, simplified] of Object.entries(traditionalToSimplifiedMap)) {
    result = result.split(traditional).join(simplified);
  }
  return result;
}

export const imageryLibrary: ImageryElement[] = [
  { keyword: '月亮', aliases: ['月', '明月', '皓月', '残月', '新月', '满月', '望月', '秋月', '江月', '山月'], category: '天文', defaultInk: 0.85 },
  { keyword: '太阳', aliases: ['日', '旭日', '落日', '夕阳', '斜阳', '残阳', '朝晖', '夕照'], category: '天文', defaultInk: 0.7 },
  { keyword: '星星', aliases: ['星', '星辰', '繁星', '疏星', '明星', '寒星', '孤星'], category: '天文', defaultInk: 0.6 },
  { keyword: '云朵', aliases: ['云', '白云', '浮云', '乌云', '彩云', '祥云', '云海', '云烟'], category: '天文', defaultInk: 0.4 },
  { keyword: '细雨', aliases: ['雨', '小雨', '春雨', '秋雨', '烟雨', '梅雨', '细雨', '骤雨', '疏雨'], category: '气象', defaultInk: 0.5 },
  { keyword: '雪花', aliases: ['雪', '白雪', '飞雪', '瑞雪', '积雪', '残雪', '寒雪'], category: '气象', defaultInk: 0.75 },
  { keyword: '风', aliases: ['风', '清风', '春风', '秋风', '东风', '西风', '南风', '北风', '狂风', '微风'], category: '气象', defaultInk: 0.35 },
  { keyword: '霜', aliases: ['霜', '白霜', '寒霜', '秋霜', '晨霜', '霜华'], category: '气象', defaultInk: 0.65 },
  { keyword: '露水', aliases: ['露', '白露', '寒露', '朝露', '露珠', '玉露'], category: '气象', defaultInk: 0.55 },
  { keyword: '柳树', aliases: ['柳', '杨柳', '垂柳', '绿柳', '烟柳', '柳絮', '柳条', '柳枝'], category: '植物', defaultInk: 0.6 },
  { keyword: '梅花', aliases: ['梅', '红梅', '腊梅', '冬梅', '梅花', '梅枝', '梅影', '暗香'], category: '植物', defaultInk: 0.8 },
  { keyword: '松树', aliases: ['松', '青松', '苍松', '古松', '老松', '松树', '松枝'], category: '植物', defaultInk: 0.85 },
  { keyword: '竹子', aliases: ['竹', '翠竹', '修竹', '竹林', '竹影', '竹枝', '竹叶', '幽篁'], category: '植物', defaultInk: 0.7 },
  { keyword: '菊花', aliases: ['菊', '秋菊', '黄菊', '金菊', '菊花', '菊影'], category: '植物', defaultInk: 0.65 },
  { keyword: '荷花', aliases: ['荷', '莲花', '菡萏', '芙蓉', '莲藕', '荷叶', '白莲', '碧荷'], category: '植物', defaultInk: 0.55 },
  { keyword: '桃花', aliases: ['桃', '桃花', '桃红', '碧桃', '桃枝', '桃园'], category: '植物', defaultInk: 0.6 },
  { keyword: '落花', aliases: ['花', '落花', '飞花', '残花', '落红', '繁花', '山花'], category: '植物', defaultInk: 0.5 },
  { keyword: '草', aliases: ['草', '青草', '芳草', '枯草', '野草', '春草', '秋草', '苔', '青苔'], category: '植物', defaultInk: 0.45 },
  { keyword: '远山', aliases: ['山', '青山', '远山', '高山', '深山', '山川', '山峰', '山峦', '群山', '苍山'], category: '景物', defaultInk: 0.3 },
  { keyword: '流水', aliases: ['水', '流水', '江水', '河水', '湖水', '溪水', '清泉', '泉水', '碧波', '涟漪'], category: '景物', defaultInk: 0.4 },
  { keyword: '瀑布', aliases: ['瀑布', '飞瀑', '流泉', '水帘', '白练'], category: '景物', defaultInk: 0.7 },
  { keyword: '岩石', aliases: ['石', '岩石', '山石', '奇石', '怪石', '磐石', '石壁'], category: '景物', defaultInk: 0.8 },
  { keyword: '古道', aliases: ['路', '古道', '小路', '山路', '小径', '蹊径', '驿路'], category: '景物', defaultInk: 0.5 },
  { keyword: '孤舟', aliases: ['舟', '船', '孤舟', '小舟', '扁舟', '渔舟', '归舟', '帆', '风帆', '征帆'], category: '景物', defaultInk: 0.75 },
  { keyword: '小桥', aliases: ['桥', '小桥', '石桥', '木桥', '拱桥', '断桥', '长桥'], category: '景物', defaultInk: 0.65 },
  { keyword: '古亭', aliases: ['亭', '古亭', '长亭', '短亭', '凉亭', '水亭', '山亭'], category: '建筑', defaultInk: 0.7 },
  { keyword: '楼阁', aliases: ['楼', '阁', '楼阁', '高楼', '危楼', '钟楼', '鼓楼', '台', '亭台'], category: '建筑', defaultInk: 0.75 },
  { keyword: '古庙', aliases: ['庙', '寺', '古庙', '古寺', '山寺', '禅院', '道观', '宝塔', '佛塔'], category: '建筑', defaultInk: 0.8 },
  { keyword: '柴门', aliases: ['门', '柴门', '院门', '山门', '窗', '寒窗', '轩窗', '棂'], category: '建筑', defaultInk: 0.7 },
  { keyword: '飞鸟', aliases: ['鸟', '飞鸟', '归鸟', '孤鸟', '沙鸥', '白鹭', '鹭', '雁', '归雁', '鸿雁'], category: '动物', defaultInk: 0.65 },
  { keyword: '鹤', aliases: ['鹤', '仙鹤', '白鹤', '松鹤', '云鹤'], category: '动物', defaultInk: 0.8 },
  { keyword: '蝴蝶', aliases: ['蝶', '蝴蝶', '粉蝶', '彩蝶', '庄蝶', '梦蝶'], category: '动物', defaultInk: 0.55 },
  { keyword: '蝉', aliases: ['蝉', '鸣蝉', '寒蝉', '蜩'], category: '动物', defaultInk: 0.6 },
  { keyword: '鱼', aliases: ['鱼', '游鱼', '锦鲤', '鲤鱼', '金鱼', '沙鱼', '江鱼'], category: '动物', defaultInk: 0.6 },
  { keyword: '萤火虫', aliases: ['萤', '萤火', '流萤', '夜光'], category: '动物', defaultInk: 0.5 },
  { keyword: '灯笼', aliases: ['灯', '灯笼', '孤灯', '青灯', '花灯', '烛', '蜡烛', '红烛', '烛火'], category: '器物', defaultInk: 0.85 },
  { keyword: '书', aliases: ['书', '书卷', '古籍', '旧书', '残卷', '画', '画卷', '丹青'], category: '器物', defaultInk: 0.75 },
  { keyword: '琴', aliases: ['琴', '古琴', '玉琴', '弦歌', '弦', '瑶琴', '素琴'], category: '器物', defaultInk: 0.7 },
  { keyword: '酒', aliases: ['酒', '酒杯', '酒樽', '金樽', '清酒', '浊酒', '一壶', '薄酒', '醉'], category: '器物', defaultInk: 0.7 },
  { keyword: '剑', aliases: ['剑', '宝剑', '长剑', '吴钩', '利剑', '剑气'], category: '器物', defaultInk: 0.85 },
  { keyword: '牧童', aliases: ['牧童', '牛', '黄牛', '老牛', '骑牛'], category: '人物', defaultInk: 0.7 },
  { keyword: '隐士', aliases: ['隐者', '隐士', '高人', '逸士', '幽人', '钓叟', '渔翁', '樵夫'], category: '人物', defaultInk: 0.75 },
  { keyword: '仕女', aliases: ['佳人', '美人', '仕女', '少女', '女子', '罗敷', '玉女'], category: '人物', defaultInk: 0.65 },
];

export function parseImagery(poemContent: string): ImageryMatch[] {
  const simplified = traditionalToSimplified(poemContent);
  const lines = simplified.split(/[\n，。！？；、,.!?;]/).filter(l => l.trim().length > 0);
  const matches: ImageryMatch[] = [];
  const foundKeywords = new Set<string>();

  lines.forEach((line, lineIndex) => {
    for (const element of imageryLibrary) {
      const allKeywords = [element.keyword, ...element.aliases];
      for (const kw of allKeywords) {
        const pos = line.indexOf(kw);
        if (pos !== -1 && !foundKeywords.has(element.keyword)) {
          foundKeywords.add(element.keyword);
          matches.push({
            keyword: element.keyword,
            position: pos,
            lineIndex,
            element,
            x: 0,
            y: 0,
            scale: 1,
            inkOpacity: element.defaultInk,
          });
          break;
        }
      }
    }
  });

  return matches;
}

export function layoutImagery(matches: ImageryMatch[], canvasWidth: number, canvasHeight: number): ImageryMatch[] {
  if (matches.length === 0) return [];

  const padding = 60;
  const usableWidth = canvasWidth - padding * 2;
  const usableHeight = canvasHeight - padding * 2;
  const n = matches.length;

  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);

  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;

  const sorted = [...matches].sort((a, b) => {
    if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
    return a.position - b.position;
  });

  return sorted.map((match, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    const baseX = padding + col * cellWidth + cellWidth / 2;
    const baseY = padding + row * cellHeight + cellHeight / 2;

    const offsetX = (Math.random() - 0.5) * cellWidth * 0.4;
    const offsetY = (Math.random() - 0.5) * cellHeight * 0.4;

    const scale = 0.7 + Math.random() * 0.6;
    const inkVariation = (Math.random() - 0.5) * 0.3;
    const inkOpacity = Math.max(0.2, Math.min(0.95, match.element.defaultInk + inkVariation));

    return {
      ...match,
      x: baseX + offsetX,
      y: baseY + offsetY,
      scale,
      inkOpacity,
    };
  });
}

export const defaultPoem: PoemData = {
  title: '静夜思',
  author: '李白',
  content: `床前明月光，
疑是地上霜。
举头望明月，
低头思故乡。`
};

export const traditionalColors = [
  { name: '花青', value: '#2b4f6c' },
  { name: '藤黄', value: '#d4a017' },
  { name: '胭脂', value: '#c0392b' },
  { name: '赭石', value: '#7d4e24' },
  { name: '石绿', value: '#4a7c59' },
  { name: '钛白', value: '#ffffff' },
  { name: '朱砂', value: '#cc3d0f' },
  { name: '墨黑', value: '#2c2c2c' },
];
