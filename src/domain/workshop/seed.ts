/** 工坊基础数据：工序、古籍、材料的初始定义 */

import type { BookDef, MaterialDef, StageDef } from './types';

export const STAGES: StageDef[] = [
  { id: 'inspect', name: '清检' },
  { id: 'mend', name: '修补' },
  { id: 'complete', name: '补全' },
  { id: 'bind', name: '装订' },
  { id: 'archive', name: '典藏' },
];

export const BOOKS: BookDef[] = [
  { id: 'book-shanhaijing', title: '山海经', author: '佚名' },
  { id: 'book-shuijingzhu', title: '水经注', author: '郦道元' },
  { id: 'book-qiminyaoshu', title: '齐民要术', author: '贾思勰' },
  { id: 'book-tiangongkaiwu', title: '天工开物', author: '宋应星' },
];

export const MATERIALS: MaterialDef[] = [
  { id: 'mat-xuanzhi', name: '宣纸', unit: '张', initialStock: 100 },
  { id: 'mat-jianghu', name: '浆糊', unit: '盅', initialStock: 40 },
  { id: 'mat-sixian', name: '丝线', unit: '束', initialStock: 60 },
  { id: 'mat-mozhi', name: '墨汁', unit: '瓶', initialStock: 25 },
];
