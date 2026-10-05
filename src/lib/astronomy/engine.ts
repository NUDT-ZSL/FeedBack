import { DEG, angleDiff } from './constants';
import { civilToJd, jdToCivil, CivilDateTime } from './time';
import { sunState, moonState, findSyzygy, nearestSyzygyGuess, SyzygyKind } from './ephemeris';
import { solarGeometry, lunarGeometry, SolarGeometry, LunarGeometry } from './geometry';
import { Observer } from './observer';
import { topocentricBody, angularSeparationDeg, topocentricSeparationDeg } from './observer';
import { judgeVisibility, VisibilityVerdict } from './visibility';

export type EclipseKind = 'solar' | 'lunar';

export interface EclipseInput {
  year: number;
  month: number;
  day: number;
  kind?: EclipseKind | 'auto';
  observer?: Observer;
}

export interface PhaseInfo {
  key: string;
  label: string;
  jdUtc: number;
  utc: CivilDateTime;
  local: CivilDateTime | null;
  localOffsetHours: number | null;
}

export interface EclipseResult {
  input: EclipseInput;
  kind: EclipseKind;
  syzygyJd: number;
  frame: 'geocentric' | 'topocentric';
  type: string;
  typeLabel: string;
  magnitude: number;
  effectiveMagnitude: number;
  geometry: SolarGeometry | LunarGeometry;
  phases: PhaseInfo[];
  visibility: VisibilityVerdict | null;
}

export const SOLAR_TYPE_LABELS: Record<string, string> = {
  none: '无日食',
  partial: '日偏食',
  annular: '日环食',
  total: '日全食',
};

export const LUNAR_TYPE_LABELS: Record<string, string> = {
  none: '无月食',
  penumbral: '半影月食',
  partial: '月偏食',
  total: '月全食',
};

const SOLAR_PHASE_LABELS: Record<string, string> = {
  first: '初亏',
  second: '食既',
  max: '食甚',
  third: '生光',
  fourth: '复圆',
};

const LUNAR_PHASE_LABELS: Record<string, string> = {
  penumbralFirst: '半影食始',
  umbralFirst: '初亏',
  umbralSecond: '食既',
  max: '食甚',
  umbralThird: '生光',
  umbralFourth: '复圆',
  penumbralFourth: '半影食终',
};

function geocentricRelativeSpeedDegPerDay(jd: number): number {
  const h = 0.05;
  const rate = (body: 'sun' | 'moon') => {
    const f = body === 'sun' ? sunState : moonState;
    return angleDiff(f(jd + h).longitude, f(jd - h).longitude) / (2 * h);
  };
  return rate('moon') - rate('sun');
}

function buildPhases(
  entries: Array<[string, number | null]>,
  labels: Record<string, string>,
  observer: Observer | undefined,
): PhaseInfo[] {
  return entries
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([key, jd]) => {
      const utc = jdToCivil(jd);
      const local = observer ? jdToCivil(jd + observer.timezoneOffsetHours / 24) : null;
      return {
        key,
        label: labels[key] ?? key,
        jdUtc: jd,
        utc,
        local,
        localOffsetHours: observer ? observer.timezoneOffsetHours : null,
      };
    });
}

function shadowRadii(jd: number) {
  const sun = sunState(jd);
  const moon = moonState(jd);
  const earthAngularDeg = Math.asin(6371.0 / moon.distanceKm) * DEG;
  const sunParallaxDeg = Math.asin(6371.0 / sun.distanceKm) * DEG;
  return {
    umbralRadiusDeg: earthAngularDeg + sunParallaxDeg - sun.angularRadiusDeg,
    penumbralRadiusDeg: earthAngularDeg + sunParallaxDeg + sun.angularRadiusDeg,
  };
}

const TOPO_WINDOW = 0.2;
const TOPO_SCAN_STEP = 0.005;
const CONTACT_SEARCH_LIMIT = 0.45;
const CONTACT_STEP = 0.005;

function findTopocentricMaximum(tConj: number, observer: Observer): number {
  let bestJd = tConj;
  let bestSep = topocentricSeparationDeg(tConj, observer);
  for (let t = tConj - TOPO_WINDOW; t <= tConj + TOPO_WINDOW; t += TOPO_SCAN_STEP) {
    const sep = topocentricSeparationDeg(t, observer);
    if (sep < bestSep) {
      bestSep = sep;
      bestJd = t;
    }
  }
  let lo = bestJd - TOPO_SCAN_STEP;
  let hi = bestJd + TOPO_SCAN_STEP;
  for (let i = 0; i < 50; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (topocentricSeparationDeg(m1, observer) < topocentricSeparationDeg(m2, observer)) {
      hi = m2;
    } else {
      lo = m1;
    }
  }
  return (lo + hi) / 2;
}

function contactRoot(
  tMax: number,
  level: number,
  observer: Observer,
  direction: -1 | 1,
): number | null {
  const atMax = topocentricSeparationDeg(tMax, observer) - level;
  if (atAtMaxNoContact(atMax)) return null;
  let inner = tMax;
  let outer = tMax + direction * CONTACT_STEP;
  const limit = tMax + direction * CONTACT_SEARCH_LIMIT;
  while ((direction === 1 ? outer <= limit : outer >= limit)) {
    const f = topocentricSeparationDeg(outer, observer) - level;
    if (f >= 0) {
      let a = inner;
      let b = outer;
      let fa = topocentricSeparationDeg(a, observer) - level;
      for (let i = 0; i < 50; i += 1) {
        const mid = (a + b) / 2;
        const fm = topocentricSeparationDeg(mid, observer) - level;
        if (fa * fm <= 0) {
          b = mid;
        } else {
          a = mid;
          fa = fm;
        }
      }
      return (a + b) / 2;
    }
    inner = outer;
    outer += direction * CONTACT_STEP;
  }
  return null;
}

function atAtMaxNoContact(atMax: number): boolean {
  return atMax > 1e-12;
}

export function computeEclipse(input: EclipseInput): EclipseResult {
  const jdInput = civilToJd({ year: input.year, month: input.month, day: input.day, hour: 12 });
  const kindPref = input.kind ?? 'auto';

  const candidates: Array<{ kind: EclipseKind; syzygy: SyzygyKind }> =
    kindPref === 'solar'
      ? [{ kind: 'solar', syzygy: 'new' }]
      : kindPref === 'lunar'
        ? [{ kind: 'lunar', syzygy: 'full' }]
        : [
            { kind: 'solar', syzygy: 'new' },
            { kind: 'lunar', syzygy: 'full' },
          ];

  let best: EclipseResult | null = null;
  for (const cand of candidates) {
    const t0 = findSyzygy(nearestSyzygyGuess(jdInput, cand.syzygy), cand.syzygy);
    const result =
      cand.kind === 'solar'
        ? buildSolarResult(input, t0)
        : buildLunarResult(input, t0);
    if (
      best === null ||
      (result.magnitude > 0 && best.magnitude <= 0) ||
      ((result.magnitude > 0) === (best.magnitude > 0) &&
        Math.abs(result.syzygyJd - jdInput) < Math.abs(best.syzygyJd - jdInput))
    ) {
      best = result;
    }
  }
  return best as EclipseResult;
}

function buildSolarResult(input: EclipseInput, tConj: number): EclipseResult {
  const speed = geocentricRelativeSpeedDegPerDay(tConj);

  if (input.observer) {
    const observer = input.observer;
    const tMax = findTopocentricMaximum(tConj, observer);
    const sun = topocentricBody(tMax, observer, 'sun');
    const moon = topocentricBody(tMax, observer, 'moon');
    const dDeg = angularSeparationDeg(sun, moon);
    const geometry = solarGeometry(tMax, dDeg, sun.angularRadiusDeg, moon.angularRadiusDeg, speed);

    const externalLevel = sun.angularRadiusDeg + moon.angularRadiusDeg;
    const internalLevel = Math.abs(moon.angularRadiusDeg - sun.angularRadiusDeg);
    const first = contactRoot(tMax, externalLevel, observer, -1);
    const fourth = contactRoot(tMax, externalLevel, observer, 1);
    const second = contactRoot(tMax, internalLevel, observer, -1);
    const third = contactRoot(tMax, internalLevel, observer, 1);

    const hasExternal = first !== null && fourth !== null;
    if (!hasExternal) {
      geometry.type = 'none';
      geometry.magnitude = 0;
      geometry.obscuration = 0;
      geometry.durationDays = 0;
      geometry.centralDurationDays = 0;
      geometry.contacts.first = null;
      geometry.contacts.second = null;
      geometry.contacts.third = null;
      geometry.contacts.fourth = null;
    } else {
      geometry.contacts.first = first;
      geometry.contacts.fourth = fourth;
      geometry.durationDays = fourth! - first!;
      const hasInternal = second !== null && third !== null;
      geometry.contacts.second = second;
      geometry.contacts.third = third;
      geometry.centralDurationDays = hasInternal ? third! - second! : 0;
    }
    geometry.contacts.max = tMax;

    const phases = buildPhases(
      [
        ['first', geometry.contacts.first],
        ['second', geometry.contacts.second],
        ['max', geometry.contacts.max],
        ['third', geometry.contacts.third],
        ['fourth', geometry.contacts.fourth],
      ],
      SOLAR_PHASE_LABELS,
      observer,
    );
    const visibility = judgeVisibility(
      [geometry.contacts.first, geometry.contacts.max, geometry.contacts.fourth],
      geometry.type === 'none' ? 0 : geometry.magnitude,
      observer,
      'sun',
    );
    return {
      input,
      kind: 'solar',
      syzygyJd: tConj,
      frame: 'topocentric',
      type: geometry.type,
      typeLabel: SOLAR_TYPE_LABELS[geometry.type],
      magnitude: geometry.type === 'none' ? 0 : geometry.magnitude,
      effectiveMagnitude: geometry.type === 'none' ? 0 : geometry.magnitude,
      geometry,
      phases,
      visibility,
    };
  }

  const sun = sunState(tConj);
  const moon = moonState(tConj);
  const dDeg = Math.abs(moon.latitude);
  const geometry = solarGeometry(tConj, dDeg, sun.angularRadiusDeg, moon.angularRadiusDeg, speed);
  const phases = buildPhases(
    [
      ['first', geometry.contacts.first],
      ['second', geometry.contacts.second],
      ['max', geometry.contacts.max],
      ['third', geometry.contacts.third],
      ['fourth', geometry.contacts.fourth],
    ],
    SOLAR_PHASE_LABELS,
    undefined,
  );
  return {
    input,
    kind: 'solar',
    syzygyJd: tConj,
    frame: 'geocentric',
    type: geometry.type,
    typeLabel: SOLAR_TYPE_LABELS[geometry.type],
    magnitude: geometry.magnitude,
    effectiveMagnitude: geometry.magnitude,
    geometry,
    phases,
    visibility: null,
  };
}

function buildLunarResult(input: EclipseInput, t0: number): EclipseResult {
  const moon = moonState(t0);
  const dDeg = Math.abs(moon.latitude);
  const speed = geocentricRelativeSpeedDegPerDay(t0);
  const { umbralRadiusDeg, penumbralRadiusDeg } = shadowRadii(t0);
  const geometry = lunarGeometry(
    t0,
    dDeg,
    moon.angularRadiusDeg,
    umbralRadiusDeg,
    penumbralRadiusDeg,
    speed,
  );
  const phases = buildPhases(
    [
      ['penumbralFirst', geometry.contacts.penumbralFirst],
      ['umbralFirst', geometry.contacts.umbralFirst],
      ['umbralSecond', geometry.contacts.umbralSecond],
      ['max', geometry.contacts.max],
      ['umbralThird', geometry.contacts.umbralThird],
      ['umbralFourth', geometry.contacts.umbralFourth],
      ['penumbralFourth', geometry.contacts.penumbralFourth],
    ],
    LUNAR_PHASE_LABELS,
    input.observer,
  );
  const visibility = input.observer
    ? judgeVisibility(
        [
          geometry.contacts.penumbralFirst,
          geometry.contacts.umbralFirst,
          geometry.contacts.umbralSecond,
          geometry.contacts.max,
          geometry.contacts.umbralThird,
          geometry.contacts.umbralFourth,
          geometry.contacts.penumbralFourth,
        ],
        Math.max(geometry.umbralMagnitude, geometry.penumbralMagnitude),
        input.observer,
        'moon',
      )
    : null;
  return {
    input,
    kind: 'lunar',
    syzygyJd: t0,
    frame: 'geocentric',
    type: geometry.type,
    typeLabel: LUNAR_TYPE_LABELS[geometry.type],
    magnitude: geometry.umbralMagnitude,
    effectiveMagnitude: Math.max(geometry.umbralMagnitude, geometry.penumbralMagnitude),
    geometry,
    phases,
    visibility,
  };
}

export function listSyzygies(
  startYear: number,
  endYear: number,
): Array<{ jd: number; kind: EclipseKind; magnitude: number; type: string }> {
  const out: Array<{ jd: number; kind: EclipseKind; magnitude: number; type: string }> = [];
  const startJd = civilToJd({ year: startYear, month: 1, day: 1, hour: 0 });
  const endJd = civilToJd({ year: endYear, month: 12, day: 31, hour: 0 });
  const step = 29.0;
  for (let jd = startJd; jd < endJd; jd += step) {
    for (const [kind, syzygy] of [
      ['solar', 'new'],
      ['lunar', 'full'],
    ] as Array<[EclipseKind, SyzygyKind]>) {
      const t0 = findSyzygy(nearestSyzygyGuess(jd, syzygy), syzygy);
      if (t0 < startJd || t0 >= endJd) continue;
      const result =
        kind === 'solar'
          ? buildSolarResult({ year: startYear, month: 1, day: 1 }, t0)
          : buildLunarResult({ year: startYear, month: 1, day: 1 }, t0);
      if (result.magnitude > 0) {
        const dup = out.some((o) => o.kind === kind && Math.abs(o.jd - t0) < 1);
        if (!dup) {
          out.push({ jd: t0, kind, magnitude: result.magnitude, type: result.type });
        }
      }
    }
  }
  out.sort((a, b) => a.jd - b.jd);
  return out;
}
