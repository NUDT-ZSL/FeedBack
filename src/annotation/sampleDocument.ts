import { createParagraph } from './documentModel.js';
import type { Paragraph } from './types.js';

/** 工作台初始示例文档（离线内置，无网络依赖）。 */
export function createSampleParagraphs(): Paragraph[] {
  return [
    createParagraph('桂枝汤方：桂枝三两，芍药三两，甘草二两，生姜三两，大枣十二枚。'),
    createParagraph('煎服法：以水七升，微火煮取三升，去滓，适寒温，服一升。'),
    createParagraph('服已须臾，啜热稀粥一升余，以助药力，温覆令一时许。'),
    createParagraph('禁忌：服药期间忌食生冷、黏滑、肉面、五辛、酒酪、臭恶等物。'),
    createParagraph('加减：若喘者，加麻黄；若项背强几几者，加葛根四两。'),
  ];
}
