import type { IronCertificate, SaltCertificate, SearchResult } from '../../src/types';
import { searchRecords } from '../../src/lib/search';
import {
  assert,
  assertDeepEqual,
  type Check,
} from '../framework';

function expectedOrder(
  salt: SaltCertificate[],
  iron: IronCertificate[],
  sortOrder: 'asc' | 'desc',
): Array<{ type: SearchResult['type']; id: string }> {
  const rank: Record<SearchResult['type'], number> = { salt: 0, iron: 1 };
  const entries: Array<{ type: SearchResult['type']; id: string; date: number }> = [
    ...salt.map((c) => ({ type: 'salt' as const, id: c.id, date: new Date(c.issueDate).getTime() })),
    ...iron.map((c) => ({ type: 'iron' as const, id: c.id, date: new Date(c.issueDate).getTime() })),
  ];
  entries.sort((a, b) => {
    if (a.date !== b.date) {
      return sortOrder === 'asc' ? a.date - b.date : b.date - a.date;
    }
    if (rank[a.type] !== rank[b.type]) {
      return rank[a.type] - rank[b.type];
    }
    return a.id.localeCompare(b.id);
  });
  return entries.map(({ type, id }) => ({ type, id }));
}

export const searchChecks: Check[] = [
  {
    id: 'SEARCH-01',
    name: '盐引、铁券混合命中时按固定口径排序',
    run: async ({ server }) => {
      const [{ body: salt }, { body: iron }] = await Promise.all([
        server.client.get<SaltCertificate[]>('/api/salt-certificates'),
        server.client.get<IronCertificate[]>('/api/iron-certificates'),
      ]);

      for (const sortOrder of ['asc', 'desc'] as const) {
        const results = searchRecords(salt, iron, '', sortOrder);
        assertDeepEqual(
          results.map((r) => ({ type: r.type, id: r.data.id })),
          expectedOrder(salt, iron, sortOrder),
          `混合搜索排序口径错误 (${sortOrder})`,
        );
        assert(
          results.some((r) => r.type === 'salt') && results.some((r) => r.type === 'iron'),
          '前置数据应同时命中盐引与铁券',
        );
      }
    },
  },
  {
    id: 'SEARCH-02',
    name: '相同输入重复执行搜索结论完全一致',
    run: async ({ server }) => {
      const [{ body: salt }, { body: iron }] = await Promise.all([
        server.client.get<SaltCertificate[]>('/api/salt-certificates'),
        server.client.get<IronCertificate[]>('/api/iron-certificates'),
      ]);
      const first = searchRecords(salt, iron, '盐引', 'desc');
      for (let i = 0; i < 3; i++) {
        assertDeepEqual(
          searchRecords(salt, iron, '盐引', 'desc'),
          first,
          `第 ${i + 2} 次搜索结果与首次不一致`,
        );
      }
    },
  },
  {
    id: 'SEARCH-03',
    name: '同日期记录排序稳定且跨类型次序固定',
    run: async ({ server }) => {
      const [{ body: salt }, { body: iron }] = await Promise.all([
        server.client.get<SaltCertificate[]>('/api/salt-certificates'),
        server.client.get<IronCertificate[]>('/api/iron-certificates'),
      ]);
      const asc = searchRecords(salt, iron, '', 'asc');
      const desc = searchRecords(salt, iron, '', 'desc');

      for (let i = 1; i < asc.length; i++) {
        const prev = new Date(asc[i - 1].data.issueDate).getTime();
        const curr = new Date(asc[i].data.issueDate).getTime();
        assert(prev <= curr, 'asc 结果日期必须非降序');
      }
      for (let i = 1; i < desc.length; i++) {
        const prev = new Date(desc[i - 1].data.issueDate).getTime();
        const curr = new Date(desc[i].data.issueDate).getTime();
        assert(prev >= curr, 'desc 结果日期必须非升序');
      }

      const sameDateGroup = desc.filter(
        (r) => new Date(r.data.issueDate).getTime() === new Date(desc[0].data.issueDate).getTime(),
      );
      const firstIron = sameDateGroup.findIndex((r) => r.type === 'iron');
      const lastSalt = sameDateGroup.map((r) => r.type).lastIndexOf('salt');
      assert(firstIron === -1 || lastSalt < firstIron, '同日期记录盐引应稳定排在铁券之前');
    },
  },
  {
    id: 'SEARCH-04',
    name: '服务端列表搜索与排序重复调用结果稳定',
    run: async ({ server }) => {
      const first = await server.client.get('/api/salt-certificates?search=%E7%9B%90%E5%BC%95&sort=asc');
      const second = await server.client.get('/api/salt-certificates?search=%E7%9B%90%E5%BC%95&sort=asc');
      assertDeepEqual(second.body, first.body, '相同查询两次调用结果应一致');

      const list = first.body as SaltCertificate[];
      for (let i = 1; i < list.length; i++) {
        const prev = new Date(list[i - 1].issueDate).getTime();
        const curr = new Date(list[i].issueDate).getTime();
        assert(
          prev < curr || (prev === curr && list[i - 1].id.localeCompare(list[i].id) <= 0),
          '服务端排序口径错误(日期升序+同日期编号升序)',
        );
      }
    },
  },
];
