import type { IronCertificate, SaltCertificate, SearchResult } from '../types';

export type SortOrder = 'asc' | 'desc';

const TYPE_RANK: Record<SearchResult['type'], number> = {
  salt: 0,
  iron: 1,
};

function compareResults(a: SearchResult, b: SearchResult, sortOrder: SortOrder): number {
  const dateA = new Date(a.data.issueDate).getTime();
  const dateB = new Date(b.data.issueDate).getTime();
  if (dateA !== dateB) {
    return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
  }
  const typeDiff = TYPE_RANK[a.type] - TYPE_RANK[b.type];
  if (typeDiff !== 0) {
    return typeDiff;
  }
  return a.data.id.localeCompare(b.data.id);
}

export function searchRecords(
  saltCerts: SaltCertificate[],
  ironCerts: IronCertificate[],
  query: string,
  sortOrder: SortOrder,
): SearchResult[] {
  const lowerQuery = query.trim().toLowerCase();

  const matchedSalt: SearchResult[] = saltCerts
    .filter((cert) => cert.id.toLowerCase().includes(lowerQuery))
    .map((cert) => ({ type: 'salt', data: cert }));

  const matchedIron: SearchResult[] = ironCerts
    .filter((cert) => cert.holderName.toLowerCase().includes(lowerQuery))
    .map((cert) => ({ type: 'iron', data: cert }));

  return [...matchedSalt, ...matchedIron].sort((a, b) => compareResults(a, b, sortOrder));
}
