(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AnomalyAnalyzer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const METRIC_TIME_KEYS = ["date", "time", "timestamp", "datetime", "day", "日期", "时间"];
  const METRIC_VALUE_KEYS = ["value", "metric_value", "指标值", "数值", "val"];
  const METRIC_NAME_KEYS = ["metric_name", "metric", "name", "指标名称", "指标"];
  const EVENT_TIME_KEYS = ["date", "time", "timestamp", "datetime", "event_time", "日期", "时间"];
  const EVENT_TYPE_KEYS = ["event_type", "type", "event", "name", "事件类型", "事件"];
  const EVENT_DESC_KEYS = ["description", "desc", "detail", "details", "note", "描述", "说明"];

  function parseCsv(text) {
    if (typeof text !== "string") throw new Error("CSV 内容必须是文本");
    const content = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < content.length; i += 1) {
      const ch = content[i];
      if (quoted) {
        if (ch === '"' && content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += ch;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    const nonEmpty = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
    if (!nonEmpty.length) return [];
    const headers = nonEmpty[0].map((h) => h.trim());
    return nonEmpty.slice(1).map((cells) => {
      const item = {};
      headers.forEach((header, idx) => {
        if (header) item[header] = (cells[idx] || "").trim();
      });
      return item;
    });
  }

  function pickKey(row, candidates) {
    const keys = Object.keys(row);
    const lower = new Map(keys.map((key) => [key.toLowerCase(), key]));
    for (const name of candidates) {
      const hit = lower.get(name.toLowerCase());
      if (hit) return hit;
    }
    return keys.find((key) => candidates.some((name) => key.toLowerCase().includes(name.toLowerCase())));
  }

  function parseDateValue(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const text = String(value).trim();
    const day = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/);
    if (day) {
      const y = Number(day[1]);
      const m = Number(day[2]);
      const d = Number(day[3]);
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) {
        return dt.toISOString().slice(0, 10);
      }
    }
    const parsed = new Date(text.replace(/\//g, "-"));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
  }

  function parseNumber(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const text = String(value).replace(/[,，%\s]/g, "");
    if (text === "" || /^(na|n\/a|null|none|-)$/i.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function addDays(dateText, delta) {
    const dt = new Date(`${dateText}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  }

  function dateRange(start, end) {
    const result = [];
    for (let date = start; date <= end; date = addDays(date, 1)) result.push(date);
    return result;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function quantile(sortedValues, q) {
    if (!sortedValues.length) return null;
    const pos = (sortedValues.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sortedValues[base + 1] !== undefined
      ? sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base])
      : sortedValues[base];
  }

  function robustScale(values, center) {
    if (values.length < 2) return 0;
    const deviations = values.map((v) => Math.abs(v - center));
    const mad = median(deviations);
    if (mad !== null && mad > 0) return 1.4826 * mad;
    const sorted = [...values].sort((a, b) => a - b);
    const iqr = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.349;
    if (iqr > 0) return iqr;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1));
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function pearson(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return 0;
    const xm = mean(xs.slice(0, n));
    const ym = mean(ys.slice(0, n));
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const x = xs[i] - xm;
      const y = ys[i] - ym;
      num += x * y;
      dx += x * x;
      dy += y * y;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }

  function normalizeMetrics(rows) {
    const issues = [];
    if (!rows.length) return { metrics: [], metricNames: [], timeline: [], issues };
    const sample = rows[0];
    const timeKey = pickKey(sample, METRIC_TIME_KEYS);
    const valueKey = pickKey(sample, METRIC_VALUE_KEYS);
    const nameKey = pickKey(sample, METRIC_NAME_KEYS);
    if (!timeKey) issues.push({ level: "critical", scope: "metrics", message: "指标数据缺少可识别的日期列" });
    if (!valueKey) issues.push({ level: "critical", scope: "metrics", message: "指标数据缺少可识别的数值列" });
    if (!timeKey || !valueKey) return { metrics: [], metricNames: [], timeline: [], issues };

    const raw = new Map();
    rows.forEach((row, index) => {
      const date = parseDateValue(row[timeKey]);
      const value = parseNumber(row[valueKey]);
      const metric = (nameKey && row[nameKey] ? row[nameKey] : "指标").trim() || "指标";
      if (!date) {
        issues.push({ level: "warning", scope: "metrics", row: index + 2, metric, message: `第 ${index + 2} 行日期无法识别，已跳过` });
        return;
      }
      if (value === null) {
        const key = `${metric}|${date}`;
        if (!raw.has(key)) raw.set(key, { metric, date, values: [], missing: 0 });
        raw.get(key).missing += 1;
        return;
      }
      const key = `${metric}|${date}`;
      if (!raw.has(key)) raw.set(key, { metric, date, values: [], missing: 0 });
      raw.get(key).values.push(value);
    });

    const metricNames = [...new Set([...raw.values()].map((x) => x.metric))].sort();
    const allDates = [...new Set([...raw.values()].map((x) => x.date))].sort();
    const start = allDates[0];
    const end = allDates[allDates.length - 1];
    if (!start || !end) return { metrics: [], metricNames: [], timeline: [], issues };
    const timeline = dateRange(start, end);
    const metrics = metricNames.flatMap((metric) => {
      const points = timeline.map((date) => {
        const found = raw.get(`${metric}|${date}`);
        const values = found ? found.values : [];
        const value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        return { date, raw: value, value, observed: values.length > 0, imputed: false,
          duplicateCount: values.length,
          conflict: values.length > 1 && Math.max(...values) - Math.min(...values) > 0 };
      });
      const duplicateRows = points.filter((p) => p.duplicateCount > 1);
      const conflictRows = points.filter((p) => p.conflict);
      duplicateRows.forEach((p) => issues.push({
        level: p.conflict ? "warning" : "info", scope: "metrics", metric, date: p.date,
        message: p.conflict
          ? `${metric} 在 ${p.date} 有 ${p.duplicateCount} 条数值不一致重复上报，已使用均值 ${p.value.toFixed(2)}`
          : `${metric} 在 ${p.date} 有 ${p.duplicateCount} 条完全重复上报，已合并`,
      }));
      if (conflictRows.length) issues.push({ level: "warning", scope: "metrics", metric,
        message: `${metric} 有 ${conflictRows.length} 天重复数值冲突，冲突日期的峰值幅度可能被均值平滑` });

      for (let i = 0; i < points.length; i += 1) {
        if (points[i].observed) continue;
        let left = i - 1;
        let right = i + 1;
        while (left >= 0 && !points[left].observed) left -= 1;
        while (right < points.length && !points[right].observed) right += 1;
        let filled = null;
        if (left >= 0 && right < points.length) {
          const span = right - left;
          filled = points[left].raw + (points[right].raw - points[left].raw) * ((i - left) / span);
        } else if (left >= 0) filled = points[left].raw;
        else if (right < points.length) filled = points[right].raw;
        points[i].value = filled;
        points[i].imputed = filled !== null;
      }
      const missingCount = points.filter((p) => !p.observed).length;
      if (missingCount && missingCount !== points.length) issues.push({ level: "warning", scope: "metrics", metric,
        message: `${metric} 有 ${missingCount} 天缺失，缺失点采用线性插补；若缺失位于异常或事件窗口内，异常边界与归因强度可信度下降` });
      if (!points.some((point) => point.observed)) {
        issues.push({ level: "critical", scope: "metrics", metric,
          message: `${metric} 没有可用于分析的有效数值，已跳过该指标` });
        return [];
      }
      return [{ name: metric, points, missingCount, duplicateCount: duplicateRows.length, conflictCount: conflictRows.length }];
    });
    return { metrics, metricNames, timeline, issues };
  }

  function normalizeEvents(rows) {
    const issues = [];
    if (!rows.length) return { events: [], eventTypes: [], issues };
    const sample = rows[0];
    const timeKey = pickKey(sample, EVENT_TIME_KEYS);
    const typeKey = pickKey(sample, EVENT_TYPE_KEYS);
    const descKey = pickKey(sample, EVENT_DESC_KEYS);
    if (!timeKey || !typeKey) {
      issues.push({ level: "warning", scope: "events", message: "事件数据缺少日期或事件类型列，本次不计算事件候选" });
      return { events: [], eventTypes: [], issues };
    }
    const seen = new Set();
    const events = [];
    let invalid = 0;
    let duplicate = 0;
    rows.forEach((row) => {
      const date = parseDateValue(row[timeKey]);
      const type = String(row[typeKey] || "").trim();
      if (!date || !type) {
        invalid += 1;
        return;
      }
      const description = descKey ? String(row[descKey] || "").trim() : "";
      const key = `${date}|${type}|${description}`;
      if (seen.has(key)) {
        duplicate += 1;
        return;
      }
      seen.add(key);
      events.push({ date, type, description: description || type, id: `${date}-${type}-${events.length}` });
    });
    events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
    if (invalid) issues.push({ level: "warning", scope: "events", message: `${invalid} 条事件记录日期或类型无效，已跳过` });
    if (duplicate) issues.push({ level: "info", scope: "events", message: `${duplicate} 条事件为完全重复上报，已合并` });
    return { events, eventTypes: [...new Set(events.map((e) => e.type))].sort(), issues };
  }

  function detectSegments(metric) {
    const points = metric.points;
    points.forEach((point, i) => {
      const prior = points.slice(Math.max(0, i - 14), i).filter((p) => p.observed && Number.isFinite(p.value));
      const history = prior.length >= 7 ? prior : points.filter((p, j) => j !== i && p.observed && Number.isFinite(p.value));
      if (history.length < 4) {
        Object.assign(point, { baseline: point.value, scale: 0, zScore: 0, deviationPct: 0, abnormal: false });
        return;
      }
      const base = median(history.map((p) => p.value));
      const scale = robustScale(history.map((p) => p.value), base);
      const diff = point.value - base;
      const z = scale > 0 ? diff / scale : (Math.abs(diff) > 1e-9 ? 3.5 * Math.sign(diff) : 0);
      const pct = base !== 0 ? (diff / Math.abs(base)) * 100 : (diff !== 0 ? 100 * Math.sign(diff) : 0);
      Object.assign(point, { baseline: base, scale, zScore: z, deviationPct: pct,
        abnormal: Number.isFinite(valueAt(point)) && Math.abs(z) >= 2.5 && Math.abs(pct) >= 5 });
    });

    const runs = [];
    let run = null;
    points.forEach((p, i) => {
      if (p.abnormal) {
        if (run && i - run.end <= 2 && points.slice(run.end + 1, i).every((q) => !q.observed)) {
          run.end = i;
        } else {
          if (run) runs.push(run);
          run = { start: i, end: i };
        }
      }
    });
    if (run) runs.push(run);

    return runs.filter((r) => {
      const part = points.slice(r.start, r.end + 1);
      return part.filter((p) => p.observed).length >= 2 || Math.max(...part.map((p) => Math.abs(p.zScore || 0))) >= 5.5;
    }).map((r, index) => {
      const part = points.slice(r.start, r.end + 1);
      const dir = part.reduce((acc, p) => Math.abs(p.zScore) > Math.abs(acc.zScore || 0) ? p : acc, part[0]).zScore >= 0 ? "up" : "down";
      const peak = part.reduce((acc, p) => Math.abs(p.zScore) > Math.abs(acc.zScore || 0) ? p : acc, part[0]);
      const startLead = addDays(points[r.start].date, -3);
      const endDate = points[r.end].date;
      const extended = points.filter((p) => p.date >= startLead && p.date <= endDate);
      const missingLead = extended.filter((p) => p.date < points[r.start].date && !p.observed).length;
      const missingInSegment = part.filter((p) => !p.observed).length;
      const duplicateInWindow = extended.filter((p) => p.duplicateCount > 1).length;
      const conflictInWindow = extended.filter((p) => p.conflict).length;
      const qualityFlags = [];
      if (missingInSegment) qualityFlags.push({ type: "missing_inside", level: "high", message: `区段内 ${missingInSegment} 天缺失，起止边界和峰值偏离可能被插补值改变` });
      if (missingLead) qualityFlags.push({ type: "missing_lead", level: "medium", message: `异常前 3 天有 ${missingLead} 天缺失，事件延迟效应可能漏判` });
      if (conflictInWindow) qualityFlags.push({ type: "duplicate_conflict", level: "medium", message: `归因窗口有 ${conflictInWindow} 天重复上报数值冲突，均值处理可能平滑偏离程度` });
      else if (duplicateInWindow) qualityFlags.push({ type: "duplicate", level: "low", message: `归因窗口有 ${duplicateInWindow} 天完全重复上报，已合并，不影响数值` });
      const meanPct = part.reduce((sum, p) => sum + p.deviationPct, 0) / part.length;
      return {
        id: `seg-${index + 1}`,
        start: points[r.start].date,
        end: endDate,
        direction: dir,
        directionText: dir === "up" ? "上升" : "下降",
        days: part.length,
        observedDays: part.filter((p) => p.observed).length,
        peakDate: peak.date,
        peakZ: Number(peak.zScore.toFixed(2)),
        peakDeviationPct: Number(peak.deviationPct.toFixed(1)),
        averageDeviationPct: Number(meanPct.toFixed(1)),
        severity: Math.abs(peak.zScore) >= 5 || Math.abs(peak.deviationPct) >= 30 ? "high" : Math.abs(peak.zScore) >= 3.5 ? "medium" : "low",
        qualityFlags,
        candidates: [],
        attribution: null,
        history: [],
      };
    });
  }

  function valueAt(point) {
    return Number.isFinite(point.value) ? point.value : null;
  }

  function eventDatesByType(events) {
    const map = new Map();
    events.forEach((event) => {
      if (!map.has(event.type)) map.set(event.type, new Set());
      map.get(event.type).add(event.date);
    });
    return map;
  }

  function exposureFor(dateSet, date, leadDays) {
    for (let lag = 0; lag <= leadDays; lag += 1) {
      if (dateSet.has(addDays(date, -lag))) return lag;
    }
    return -1;
  }

  function scoreEventTypes(points, segments, events) {
    const byType = eventDatesByType(events);
    const knownSegmentDates = new Set(segments.flatMap((seg) => dateRange(seg.start, seg.end)));
    const result = new Map();
    byType.forEach((dateSet, type) => {
      const xs = [];
      const ys = [];
      let exposed = 0;
      let exposedAbnormal = 0;
      let unexposed = 0;
      let unexposedAbnormal = 0;
      let upCount = 0;
      let downCount = 0;
      let evidence = 0;
      points.forEach((point) => {
        if (!point.observed || knownSegmentDates.has(point.date) || !Number.isFinite(point.zScore)) return;
        const lag = exposureFor(dateSet, point.date, 3);
        const abnormal = Math.abs(point.zScore) >= 2.5;
        if (lag >= 0) {
          exposed += 1;
          if (abnormal) {
            exposedAbnormal += 1;
            if (point.zScore >= 0) upCount += 1;
            else downCount += 1;
            evidence += Math.min(1, Math.abs(point.zScore) / 5);
          }
          xs.push(1);
        } else {
          unexposed += 1;
          if (abnormal) unexposedAbnormal += 1;
          xs.push(0);
        }
        ys.push(Math.min(8, Math.max(-8, point.zScore)));
      });
      const hitRate = exposed ? exposedAbnormal / exposed : 0;
      const baseRate = unexposed ? unexposedAbnormal / unexposed : 0;
      const lift = baseRate > 0 ? Math.min(3, hitRate / baseRate) : hitRate > 0 ? Math.min(3, 1 + hitRate * 4) : 1;
      result.set(type, {
        occurrences: exposed, coOccurrences: exposedAbnormal, hitRate, baseRate, lift,
        evidence,
        correlation: pearson(xs, ys), upCount, downCount,
        upRatio: exposedAbnormal ? upCount / exposedAbnormal : null,
        downRatio: exposedAbnormal ? downCount / exposedAbnormal : null,
      });
    });
    return result;
  }

  function buildCandidates(segment, points, events, historyStats) {
    const startLead = addDays(segment.start, -3);
    const inWindow = events.filter((event) => event.date >= startLead && event.date <= segment.end);
    const grouped = new Map();
    inWindow.forEach((event) => {
      if (!grouped.has(event.type)) grouped.set(event.type, []);
      grouped.get(event.type).push(event);
    });
    const candidates = [];
    grouped.forEach((matchedEvents, type) => {
      const stats = historyStats.get(type) || { occurrences: 0, coOccurrences: 0, hitRate: 0,
        evidence: 0, baseRate: 0, lift: 1, correlation: 0, upCount: 0, downCount: 0, upRatio: null, downRatio: null };
      const leadDays = Math.min(...matchedEvents.map((event) => Math.max(0, Math.round(
        (new Date(`${segment.start}T00:00:00Z`) - new Date(`${event.date}T00:00:00Z`)) / 86400000))));
      const proximityScore = Math.max(0, 25 - leadDays * 5);
      let associationScore = 0;
      const warnings = [];
      if (stats.coOccurrences > 0) {
        associationScore = 22 * Math.min(stats.hitRate / 0.6, 1)
          + 18 * Math.min(stats.lift / 3, 1)
          + 12 * Math.max(stats.correlation, 0);
      }
      let directionScore = 0;
      const expectedDirectionRatio = segment.direction === "up" ? stats.upRatio : stats.downRatio;
      if (expectedDirectionRatio !== null) {
        directionScore = 20 * expectedDirectionRatio;
        if (stats.coOccurrences >= 2 && expectedDirectionRatio <= 0.34) warnings.push("历史方向矛盾");
        else if (stats.coOccurrences >= 1 && expectedDirectionRatio < 0.5) warnings.push("历史方向不一致");
      }
      if (stats.occurrences < 3 || stats.coOccurrences === 0) warnings.push("证据不足");
      const evidenceCapped = stats.coOccurrences === 0;
      const baseScore = Math.max(0, Math.min(100, proximityScore + associationScore + directionScore + (evidenceCapped ? 0 : 8)));
      candidates.push({
        key: type, eventType: type,
        matchedEvents: matchedEvents.map(({ date, description }) => ({ date, description })),
        leadDays, stats, baseScore: Number(baseScore.toFixed(1)),
        score: Number(baseScore.toFixed(1)), weight: 1, status: "auto", warnings,
      });
    });
    const dateGroups = new Map();
    candidates.forEach((candidate) => {
      candidate.matchedEvents.forEach((event) => {
        if (!dateGroups.has(event.date)) dateGroups.set(event.date, []);
        dateGroups.get(event.date).push(candidate.eventType);
      });
    });
    dateGroups.forEach((types) => {
      if (types.length > 1) {
        [...new Set(types)].forEach((type) => {
          const candidate = candidates.find((c) => c.eventType === type);
          if (candidate && !candidate.warnings.includes("事件时间共线，需人工拆分")) {
            candidate.warnings.push("事件时间共线，需人工拆分");
          }
        });
      }
    });
    candidates.sort((a, b) => b.score - a.score || a.leadDays - b.leadDays || a.eventType.localeCompare(b.eventType));
    return candidates;
  }

  function summarizeCandidates(candidates) {
    const active = candidates.filter((candidate) => candidate.status !== "excluded");
    const weighted = active.map((candidate) => {
      const weightedScore = Math.max(0, Math.min(100, candidate.baseScore * Number(candidate.weight || 1)));
      return { ...candidate, score: Number(weightedScore.toFixed(1)) };
    }).sort((a, b) => b.score - a.score || a.leadDays - b.leadDays || a.eventType.localeCompare(b.eventType));
    const total = weighted.reduce((sum, candidate) => sum + candidate.score, 0);
    weighted.forEach((candidate) => {
      candidate.sharePct = total ? Number(((candidate.score / total) * 100).toFixed(1)) : 0;
    });
    const top = weighted[0] || null;
    const confirmed = weighted.filter((candidate) => candidate.status === "confirmed");
    let primaryEventType = null;
    let conclusion = "暂无候选事件";
    let confidence = 0;
    if (!active.length) {
      conclusion = "候选原因均已排除，暂无归因结论";
    } else if (confirmed.length) {
      primaryEventType = confirmed.sort((a, b) => b.score - a.score)[0].eventType;
      conclusion = `人工确认：${primaryEventType}`;
      confidence = Math.min(95, Math.round(confirmed[0].score + 8));
    } else if (top && top.score >= 35) {
      primaryEventType = top.eventType;
      conclusion = `最可能原因：${primaryEventType}`;
      confidence = Math.round(top.score);
    } else {
      conclusion = "暂无高可信原因，建议补充事件或人工确认";
      confidence = top ? Math.round(top.score) : 0;
    }
    return {
      primaryEventType,
      conclusion,
      confidence,
      rankedCandidates: weighted,
      hasContradiction: weighted.some((candidate) => candidate.warnings.includes("历史方向矛盾")),
      insufficientEvidence: weighted.length === 0 || weighted.every((candidate) => candidate.warnings.includes("证据不足")),
      updatedAt: null,
    };
  }

  function analyzeDataset(metricRows, eventRows = []) {
    const metricData = normalizeMetrics(metricRows);
    const eventData = normalizeEvents(eventRows);
    const issues = [...metricData.issues, ...eventData.issues];
    const metrics = metricData.metrics.map((metric) => {
      const segments = detectSegments(metric);
      segments.forEach((segment) => {
        const priorPoints = metric.points.filter((point) => point.date < segment.start);
        const historyStats = scoreEventTypes(priorPoints, [], eventData.events);
        segment.candidates = buildCandidates(segment, metric.points, eventData.events, historyStats);
        segment.attribution = summarizeCandidates(segment.candidates);
        segment.attribution.updatedAt = null;
      });
      return { ...metric, segments };
    });
    return {
      metricNames: metricData.metricNames,
      eventTypes: eventData.eventTypes,
      metrics,
      timeline: metricData.timeline,
      events: eventData.events,
      issues,
      generatedAt: new Date().toISOString(),
    };
  }

  function snapshotAttribution(segment) {
    const attribution = segment.attribution || summarizeCandidates(segment.candidates);
    return {
      conclusion: attribution.conclusion,
      primaryEventType: attribution.primaryEventType,
      confidence: attribution.confidence,
      candidates: attribution.rankedCandidates.map((candidate) => ({
        eventType: candidate.eventType,
        status: candidate.status,
        weight: candidate.weight,
        score: candidate.score,
        sharePct: candidate.sharePct,
      })),
    };
  }

  function applyAdjustment(result, metricName, segmentId, candidateKey, action, weight, note) {
    const metric = result.metrics.find((item) => item.name === metricName);
    if (!metric) throw new Error("未找到指标");
    const segment = metric.segments.find((item) => item.id === segmentId);
    if (!segment) throw new Error("未找到异常区段");
    const before = snapshotAttribution(segment);
    const candidate = segment.candidates.find((item) => item.eventType === candidateKey || item.key === candidateKey);
    if (!candidate) throw new Error("未找到候选原因");
    if (action === "confirm") candidate.status = "confirmed";
    else if (action === "exclude") candidate.status = "excluded";
    else if (action === "reset") {
      candidate.status = "auto";
      candidate.weight = 1;
    }
    else if (action === "weight") {
      if (candidate.status === "excluded") candidate.status = "auto";
    }
    const nextWeight = Number(weight);
    if (action !== "reset" && Number.isFinite(nextWeight)) candidate.weight = Math.max(0.1, Math.min(2, nextWeight));
    segment.candidates.sort((a, b) => a.eventType.localeCompare(b.eventType));
    const next = summarizeCandidates(segment.candidates);
    next.updatedAt = new Date().toISOString();
    segment.attribution = next;
    const actionText = { confirm: "确认", exclude: "排除", reset: "恢复自动", weight: "调整权重" }[action] || "调整";
    segment.history.unshift({
      id: `rev-${segment.history.length + 1}-${Date.now()}`,
      at: next.updatedAt,
      action: actionText,
      candidate: candidate.eventType,
      note: note || "",
      before,
      after: snapshotAttribution(segment),
    });
    return segment;
  }

  return {
    parseCsv,
    parseDateValue,
    parseNumber,
    analyzeDataset,
    applyAdjustment,
    summarizeCandidates,
  };
});
