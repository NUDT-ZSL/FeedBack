import type {
  DailyStats,
  InspectionLog,
  IronCertChange,
  IronCertificate,
  IronCertificateType,
  SaltCertificate,
} from '../src/types';
import type { Deps, Rng } from './deps';

export interface AppState {
  saltCertificates: SaltCertificate[];
  ironCertificates: IronCertificate[];
  inspectionLogs: InspectionLog[];
  ironCertChanges: IronCertChange[];
  dailyStats: DailyStats[];
}

export const regions = ['淮南东路', '两浙路', '河北路', '河东路', '陕西路', '江南西路', '福建路'];
export const seals = ['转运司印', '盐铁使印', '榷货务印', '提举盐事司印'];
export const secretMarks = ['青龙', '白虎', '朱雀', '玄武'];
export const inspectorNames = ['李转运使', '王判官', '张提举', '刘监官', '陈盐铁使'];
export const avatarUrls = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face',
];

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randomItem<T>(rng: Rng, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function generateSaltId(deps: Deps, existing: SaltCertificate[]): string {
  const year = deps.clock.now().getFullYear();
  for (;;) {
    const num = String(randomInt(deps.rng, 1000, 9999)).padStart(4, '0');
    const id = `盐引${year}${num}`;
    if (!existing.some((cert) => cert.id === id)) {
      return id;
    }
  }
}

export function generateIronId(deps: Deps, existing: IronCertificate[]): string {
  const year = deps.clock.now().getFullYear();
  for (;;) {
    const num = randomInt(deps.rng, 100, 999);
    const id = `铁券${year}${num}`;
    if (!existing.some((cert) => cert.id === id)) {
      return id;
    }
  }
}

export function createInitialState(): AppState {
  return {
    saltCertificates: [],
    ironCertificates: [],
    inspectionLogs: [],
    ironCertChanges: [],
    dailyStats: [],
  };
}

export function createSeedState(deps: Deps): AppState {
  const state = createInitialState();
  const today = deps.clock.now();

  for (let i = 0; i < 10; i++) {
    const issueDate = formatDate(addDays(today, -randomInt(deps.rng, 0, 30)));
    const seal = randomItem(deps.rng, seals);
    const isMatch = deps.rng() < 0.7;
    const secretMark = isMatch ? seal : randomItem(deps.rng, secretMarks);

    state.saltCertificates.push({
      id: generateSaltId(deps, state.saltCertificates),
      saltAmount: randomInt(deps.rng, 100, 500) * 10,
      issueDate,
      region: randomItem(deps.rng, regions),
      seal,
      secretMark,
      status: 'pending',
    });
  }

  const ironHolders = [
    { name: '范仲淹', title: '参知政事', type: 'exemption' as IronCertificateType },
    { name: '欧阳修', title: '枢密副使', type: 'mitigation' as IronCertificateType },
    { name: '包拯', title: '龙图阁直学士', type: 'corvee' as IronCertificateType },
  ];

  ironHolders.forEach((holder, index) => {
    state.ironCertificates.push({
      id: generateIronId(deps, state.ironCertificates),
      type: holder.type,
      holderName: holder.name,
      holderTitle: holder.title,
      holderAvatar: avatarUrls[index % avatarUrls.length],
      issueDate: formatDate(addDays(today, -randomInt(deps.rng, 30, 180))),
      expiryDate: formatDate(addDays(today, randomInt(deps.rng, 180, 365))),
      status: 'active',
    });
  });

  const issuedByDate = new Map<string, number>();
  for (const cert of state.saltCertificates) {
    issuedByDate.set(cert.issueDate, (issuedByDate.get(cert.issueDate) ?? 0) + 1);
  }
  state.dailyStats = [...issuedByDate.entries()]
    .map(([date, issued]) => ({ date, issued, verified: 0, rejected: 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return state;
}
