import {
  RELATIONS,
  jaccard,
  normalizeTags,
  contentSignature,
  textSimilarity,
  bodyClues
} from "./normalize.js";

export const CANDIDATE_THRESHOLD = 0.22;
const REVIEW_EVIDENCE_THRESHOLD = 0.16;

function activeEntry(state, id) {
  return state.entries.find(entry => entry.id === id);
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function explicitPairSet(state) {
  const result = new Set();
  for (const link of state.links || []) result.add(pairKey(link.source, link.target));
  return result;
}

export function inferPair(state, aId, bId) {
  const a = activeEntry(state, aId);
  const b = activeEntry(state, bId);
  if (!a || !b || a.id === b.id) return null;

  const tagsA = normalizeTags(a.tags);
  const tagsB = normalizeTags(b.tags);
  const sharedTags = tagsA.filter(tag => tagsB.includes(tag));
  const tagOverlap = jaccard(tagsA, tagsB);
  const bodyOverlap = textSimilarity(a.body, b.body);
  const clues = bodyClues(a.body, b.body);
  const clueBonus = Math.min(clues.length * 0.03, 0.12);
  const score = Number((tagOverlap * 0.48 + bodyOverlap * 0.4 + clueBonus).toFixed(3));

  const reasons = [];
  if (sharedTags.length) {
    reasons.push(`标签重合：${sharedTags.map(tag => `#${tag}`).join("、")}`);
  }
  if (clues.length) {
    reasons.push(`正文出现相同线索：${clues.map(text => `“${text}”`).join("、")}`);
  }
  if (!sharedTags.length && clues.length < 2) {
    reasons.push("正文主题词和问题场景接近，但证据较弱，建议人工确认");
  }

  return {
    id: `infer:${pairKey(aId, bId)}`,
    pair: [a.id, b.id].sort(),
    source: a.id < b.id ? a.id : b.id,
    target: a.id < b.id ? b.id : a.id,
    relation: "related",
    score,
    tagOverlap: Number(tagOverlap.toFixed(3)),
    bodyOverlap: Number(bodyOverlap.toFixed(3)),
    sharedTags,
    clues,
    reasons
  };
}

function decisionIsStale(decision, candidate, entries) {
  const a = entries.find(entry => entry.id === decision.pair[0]);
  const b = entries.find(entry => entry.id === decision.pair[1]);
  if (!a || !b || a.status !== "active" || b.status !== "active") return false;
  if (!decision.baseline) return false;

  const sameSignatures =
    contentSignature(a) === decision.baseline.signatures?.[a.id] &&
    contentSignature(b) === decision.baseline.signatures?.[b.id];
  if (sameSignatures) return false;

  if (decision.action === "rejected") {
    return candidate && candidate.score - decision.baseline.score >= 0.2;
  }
  if (decision.action === "confirmed" && candidate && candidate.score < REVIEW_EVIDENCE_THRESHOLD) {
    return candidate.score < decision.baseline.score - 0.08;
  }
  return false;
}

export function inferCandidates(state) {
  const explicitPairs = explicitPairSet(state);
  const decisions = new Map((state.decisions || []).map(decision =>
    [decision.pair.join("|"), decision]
  ));
  const candidates = [];

  for (let i = 0; i < state.entries.length; i += 1) {
    for (let j = i + 1; j < state.entries.length; j += 1) {
      const a = state.entries[i];
      const b = state.entries[j];
      if (a.status !== "active" || b.status !== "active") continue;
      if (explicitPairs.has(pairKey(a.id, b.id))) continue;

      const candidate = inferPair(state, a.id, b.id);
      const decision = decisions.get(candidate.pair.join("|"));
      const staleDecision = decision && decisionIsStale(decision, candidate, state.entries);
      if (decision && !staleDecision) continue;
      if (!staleDecision && candidate.score < CANDIDATE_THRESHOLD) continue;

      if (decision?.action === "rejected") {
        candidate.reasons.unshift("该关联曾被否决；双方正文发生实质变化后，再次出现较强重合");
      } else if (staleDecision) {
        candidate.reasons.unshift("该关联曾被确认；正文实质变化后证据明显减弱，请重新判断");
      }
      candidates.push(candidate);
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function latestRevisionAt(entry) {
  const revisions = entry.revisions || [];
  return revisions.length ? revisions[revisions.length - 1].at : entry.createdAt;
}

function classifyExplicitEdge(state, link) {
  const source = activeEntry(state, link.source);
  const target = activeEntry(state, link.target);
  const edge = {
    id: link.id,
    durableId: link.id,
    source: link.source,
    target: link.target,
    relation: link.relation,
    origin: "explicit",
    note: link.note || "",
    status: "active",
    reasons: link.note ? [link.note] : [],
    warnings: [],
    createdAt: link.createdAt,
    evidence: { score: 1 }
  };

  if (!source || !target) {
    edge.status = "invalid";
    edge.warnings.push("关联一端的条目不存在，关联已失效");
    return edge;
  }
  if (source.id === target.id) {
    edge.status = "invalid";
    edge.warnings.push("条目不能关联到自身");
    return edge;
  }

  const positive = link.relation === "supports" || link.relation === "refines";
  if (source.status === "deprecated" && positive) {
    edge.status = "invalid";
    edge.warnings.push(`源条目已废弃，无法继续“${RELATIONS[link.relation].label}”目标条目`);
  } else if (source.status === "merged" && link.relation !== "merges_into") {
    edge.status = "needs_review";
    edge.warnings.push("源条目已合并，原关系需要重新确认或改挂到承接条目");
  } else if (source.status !== "active" || target.status !== "active") {
    edge.status = "needs_review";
    edge.warnings.push("关联一端已不是生效条目，历史关系需要重新确认");
  }

  if (target.status === "deprecated" && ["supports", "refines"].includes(link.relation) && edge.status === "active") {
    edge.status = "needs_review";
    edge.warnings.push("目标条目已废弃，支持/细化关系需要重新确认");
  }

  const linkBaselineAt = link.lastConfirmedAt || link.createdAt || "";
  const changedAfterLink =
    latestRevisionAt(source) > linkBaselineAt ||
    latestRevisionAt(target) > linkBaselineAt;
  if (edge.status === "active" && changedAfterLink) {
    edge.status = "needs_review";
    edge.warnings.push("关联建立后，一端正文或标签发生修订，请确认关系仍成立");
  }
  return edge;
}

function decisionEdge(state, decision) {
  const [aId, bId] = decision.pair;
  const a = activeEntry(state, aId);
  const b = activeEntry(state, bId);
  if (!a || !b) return null;
  const candidate = inferPair(state, aId, bId);
  const edge = {
    id: `decision:${pairKey(aId, bId)}`,
    durableId: `decision:${pairKey(aId, bId)}`,
    source: aId < bId ? aId : bId,
    target: aId < bId ? bId : aId,
    relation: "related",
    origin: "decision",
    note: "",
    status: "active",
    reasons: candidate?.reasons || ["人工确认的关联"],
    warnings: [],
    decision: decision.action,
    evidence: candidate ? {
      score: candidate.score,
      sharedTags: candidate.sharedTags,
      clues: candidate.clues
    } : { score: 0 },
    createdAt: decision.at
  };

  if (a.status !== "active" || b.status !== "active") {
    edge.status = "needs_review";
    edge.warnings.push("人工确认关联的一端已不是生效条目");
  } else if (candidate && candidate.score < REVIEW_EVIDENCE_THRESHOLD) {
    edge.status = "needs_review";
    edge.warnings.push("正文修订后原有线索明显减弱，人工确认结果暂予保留，但需要复核");
  }
  return edge;
}

function orientation(edge, first) {
  return edge.source === first && edge.target !== first ? "forward" : "reverse";
}

function relationSignature(edge, first) {
  return `${edge.relation}:${orientation(edge, first)}`;
}

function findConflicts(edges) {
  const conflicts = [];
  const byPair = new Map();
  for (const edge of edges) {
    if (edge.status === "invalid") continue;
    const key = [edge.source, edge.target].sort().join("|");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(edge);
  }

  for (const [pair, group] of byPair) {
    if (group.length < 2) continue;
    const first = pair.split("|")[0];
    const signatures = new Set(group.map(edge => relationSignature(edge, first)));
    const relations = new Set(group.map(edge => edge.relation));
    const has = name => relations.has(name);
    let reason = "";

    if (has("supports") && has("contradicts")) {
      reason = "同一对条目同时被标记为“支持”和“矛盾”";
    } else if (has("refines") && has("contradicts")) {
      reason = "一条关系声称细化/依赖，另一条关系声称矛盾，双方判断相反";
    } else if (
      (signatures.has("refines:forward") && (signatures.has("supersedes:forward") || signatures.has("merges_into:forward"))) ||
      (signatures.has("refines:reverse") && (signatures.has("supersedes:reverse") || signatures.has("merges_into:reverse"))) ||
      (signatures.has("supersedes:forward") && signatures.has("merges_into:forward")) ||
      (signatures.has("supersedes:reverse") && signatures.has("merges_into:reverse"))
    ) {
      reason = "同一方向同时存在“细化/依赖”和否定或替代关系";
    } else if (
      (signatures.has("supports:forward") && (signatures.has("supersedes:forward") || signatures.has("merges_into:forward"))) ||
      (signatures.has("supports:reverse") && (signatures.has("supersedes:reverse") || signatures.has("merges_into:reverse")))
    ) {
      reason = "同一方向同时存在“支持”和替代/合并关系";
    } else if (["refines", "supersedes", "merges_into"].some(name =>
      signatures.has(`${name}:forward`) && signatures.has(`${name}:reverse`)
    )) {
      reason = "两个条目互相给出了同一方向性关系，指向相互矛盾";
    }

    if (reason) {
      const conflict = {
        id: `conflict:${pair}`,
        pair: pair.split("|"),
        edgeIds: group.map(edge => edge.id),
        reason
      };
      conflicts.push(conflict);
      for (const edge of group) edge.conflictIds = [conflict.id];
    }
  }
  return conflicts;
}

export function deriveGraph(state) {
  const edges = [];
  for (const link of state.links || []) edges.push(classifyExplicitEdge(state, link));
  for (const decision of state.decisions || []) {
    if (decision.action !== "confirmed") continue;
    const edge = decisionEdge(state, decision);
    if (edge) edges.push(edge);
  }

  return {
    entries: state.entries,
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    candidates: inferCandidates(state),
    conflicts: findConflicts(edges)
  };
}

export function edgeSummary(edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: edge.relation,
    status: edge.status,
    warnings: edge.warnings
  };
}

export function graphSnapshot(state) {
  const graph = deriveGraph(state);
  return {
    edges: new Map(graph.edges.map(edge => [edge.id, edgeSummary(edge)])),
    conflictPairs: new Set(graph.conflicts.map(conflict => conflict.pair.join("|"))),
    candidateIds: new Set(graph.candidates.map(candidate => candidate.id))
  };
}

export { contentSignature };
