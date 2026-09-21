import { deriveGraph, graphSnapshot, inferPair, contentSignature } from "./graph.js";
import { normalizeTags, pairId } from "./normalize.js";

export function cloneState(state) {
  return structuredClone({
    version: 1,
    entries: [],
    links: [],
    decisions: [],
    ...state
  });
}

function nextId(state, prefix) {
  state.counters ||= {};
  state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  return `${prefix}${String(state.counters[prefix]).padStart(3, "0")}`;
}

function revisionId(state) {
  return nextId(state, "rev");
}

function compareImpacts(before, after) {
  const beforeGraph = deriveGraph(before);
  const afterGraph = deriveGraph(after);
  const beforeSnap = graphSnapshot(before);
  const afterSnap = graphSnapshot(after);
  const edgeChanges = [];

  for (const [id, oldEdge] of beforeSnap.edges) {
    const newEdge = afterSnap.edges.get(id);
    if (!newEdge) {
      edgeChanges.push({ id, kind: "removed", before: oldEdge });
      continue;
    }
    if (oldEdge.status !== newEdge.status ||
      oldEdge.warnings.join("|") !== newEdge.warnings.join("|")) {
      edgeChanges.push({ id, kind: "status", before: oldEdge, after: newEdge });
    }
  }
  for (const [id, edge] of afterSnap.edges) {
    if (!beforeSnap.edges.has(id)) edgeChanges.push({ id, kind: "added", after: edge });
  }

  const candidateKey = candidate => candidate.pair.join("|");
  const oldCandidates = new Map(beforeGraph.candidates.map(item => [candidateKey(item), item]));
  const newCandidates = new Map(afterGraph.candidates.map(item => [candidateKey(item), item]));
  const candidateChanges = [];
  for (const [key, candidate] of newCandidates) {
    const old = oldCandidates.get(key);
    if (!old) {
      candidateChanges.push({ pair: key.split("|"), kind: "new", score: candidate.score });
    } else if (Math.abs(old.score - candidate.score) >= 0.05) {
      candidateChanges.push({
        pair: key.split("|"),
        kind: "score",
        before: old.score,
        after: candidate.score
      });
    }
  }
  for (const key of oldCandidates.keys()) {
    if (!newCandidates.has(key)) {
      candidateChanges.push({ pair: key.split("|"), kind: "lost" });
    }
  }

  const conflictsAdded = [...afterSnap.conflictPairs]
    .filter(key => !beforeSnap.conflictPairs.has(key))
    .map(key => key.split("|"));
  const conflictsResolved = [...beforeSnap.conflictPairs]
    .filter(key => !afterSnap.conflictPairs.has(key))
    .map(key => key.split("|"));

  const affectedEntries = new Set();
  edgeChanges.forEach(change => {
    const edge = change.after || change.before;
    affectedEntries.add(edge.source);
    affectedEntries.add(edge.target);
  });
  candidateChanges.forEach(change => change.pair.forEach(id => affectedEntries.add(id)));

  return {
    affectedEntries: [...affectedEntries].sort(),
    edgeChanges,
    candidateChanges,
    conflictsAdded,
    conflictsResolved
  };
}

function commitRevision(state, entryId, action, at, by, note, extra = {}) {
  const entry = state.entries.find(item => item.id === entryId);
  const revision = {
    id: revisionId(state),
    at,
    by: by || "当前用户",
    action,
    note: note || "",
    ...extra
  };
  entry.revisions ||= [];
  entry.revisions.push(revision);
  entry.updatedAt = at;
  return revision;
}

export function createEntry(state, input, at = new Date().toISOString(), by = "当前用户") {
  const next = cloneState(state);
  const id = input.id || nextId(next, "E");
  const entry = {
    id,
    title: input.title || "未命名经验",
    body: input.body || "",
    tags: normalizeTags(input.tags),
    status: "active",
    createdAt: at,
    updatedAt: at,
    createdBy: by,
    revisions: [{
      id: revisionId(next),
      at,
      by,
      action: "create",
      note: input.note || "创建条目"
    }]
  };
  next.entries.push(entry);
  return { state: next, entry };
}

export function rewriteEntry(state, entryId, changes, at = new Date().toISOString(), by = "当前用户") {
  const before = cloneState(state);
  const next = cloneState(state);
  const entry = next.entries.find(item => item.id === entryId);
  if (!entry) throw new Error(`条目不存在：${entryId}`);

  const previous = {
    title: entry.title,
    body: entry.body,
    tags: entry.tags
  };
  if (changes.title !== undefined) entry.title = changes.title.trim() || entry.title;
  if (changes.body !== undefined) entry.body = changes.body;
  if (changes.tags !== undefined) entry.tags = normalizeTags(changes.tags);
  if (entry.status === "deprecated") {
    entry.status = "active";
    entry.deprecatedReason = "";
  }

  const revision = commitRevision(next, entryId, "rewrite", at, by, changes.note || "改写条目", {
    previous,
    next: { title: entry.title, body: entry.body, tags: entry.tags }
  });
  revision.impact = compareImpacts(before, next);
  return { state: next, entry, revision, impact: revision.impact };
}

export function mergeEntry(state, sourceId, targetId, input = {}, at = new Date().toISOString(), by = "当前用户") {
  if (sourceId === targetId) throw new Error("不能合并到自身");
  const before = cloneState(state);
  const next = cloneState(state);
  const source = next.entries.find(item => item.id === sourceId);
  const target = next.entries.find(item => item.id === targetId);
  if (!source || !target) throw new Error("合并的源或目标条目不存在");

  const mergedBody = source.body;
  if (input.body !== undefined) {
    target.body = input.body;
  } else {
    target.body = `${target.body}\n\n【合并自 ${source.id}】\n${mergedBody}`;
  }
  target.tags = normalizeTags([...target.tags, ...source.tags, ...(input.tags || [])]);
  source.status = "merged";
  source.mergedInto = targetId;

  const existing = next.links.some(link =>
    link.source === sourceId && link.target === targetId && link.relation === "merges_into"
  );
  if (!existing) {
    next.links.push({
      id: nextId(next, "link"),
      source: sourceId,
      target: targetId,
      relation: "merges_into",
      note: input.note || "条目合并后建立的承接关系",
      createdAt: at,
      createdBy: by
    });
  }

  const revision = commitRevision(next, sourceId, "merge", at, by, input.note || `合并到 ${targetId}`, {
    mergedInto: targetId,
    previous: { body: source.body, tags: source.tags }
  });
  revision.impact = compareImpacts(before, next);
  const targetRevision = commitRevision(next, targetId, "receive_merge", at, by, `接收 ${sourceId} 合并内容`);
  targetRevision.impact = revision.impact;
  return { state: next, source, target, revision, impact: revision.impact };
}

export function deprecateEntry(state, entryId, input = {}, at = new Date().toISOString(), by = "当前用户") {
  const before = cloneState(state);
  const next = cloneState(state);
  const entry = next.entries.find(item => item.id === entryId);
  if (!entry) throw new Error(`条目不存在：${entryId}`);

  entry.status = "deprecated";
  entry.deprecatedReason = input.reason || input.note || "";
  if (input.supersededBy) entry.supersededBy = input.supersededBy;

  if (input.supersededBy) {
    const existing = next.links.some(link =>
      link.source === entryId &&
      link.target === input.supersededBy &&
      link.relation === "supersedes"
    );
    if (!existing) {
      next.links.push({
        id: nextId(next, "link"),
        source: entryId,
        target: input.supersededBy,
        relation: "supersedes",
        note: input.note || "废弃时指定的新承接条目",
        createdAt: at,
        createdBy: by
      });
    }
  }

  const revision = commitRevision(next, entryId, "deprecate", at, by, input.reason || input.note || "废弃条目");
  revision.impact = compareImpacts(before, next);
  return { state: next, entry, revision, impact: revision.impact };
}

export function addLink(state, input, at = new Date().toISOString(), by = "当前用户") {
  if (input.source === input.target) throw new Error("不能建立自关联");
  const next = cloneState(state);
  const exists = next.links.some(link =>
    link.source === input.source &&
    link.target === input.target &&
    link.relation === input.relation
  );
  if (exists) return { state: next, link: null, duplicated: true };

  const link = {
    id: nextId(next, "link"),
    source: input.source,
    target: input.target,
    relation: input.relation || "related",
    note: input.note || "",
    createdAt: at,
    createdBy: by
  };
  next.links.push(link);
  next.decisions = next.decisions.filter(decision =>
    decision.pair.join("|") !== [input.source, input.target].sort().join("|")
  );
  return { state: next, link };
}

export function setCandidateDecision(
  state,
  pair,
  action,
  at = new Date().toISOString(),
  by = "当前用户"
) {
  if (!["confirmed", "rejected"].includes(action)) {
    throw new Error("推断关联只能被确认或否决");
  }
  const next = cloneState(state);
  const orderedPair = [...pair].sort();
  const candidate = inferPair(next, orderedPair[0], orderedPair[1]);
  const entries = Object.fromEntries(next.entries.map(entry => [entry.id, entry]));
  const signatures = Object.fromEntries(orderedPair.map(id => [id, contentSignature(entries[id])]));

  const decision = {
    id: pairId(orderedPair[0], orderedPair[1], "decision"),
    pair: orderedPair,
    action,
    at,
    by,
    baseline: {
      score: candidate?.score || 0,
      signatures
    },
    history: []
  };

  const index = next.decisions.findIndex(item => item.pair.join("|") === orderedPair.join("|"));
  if (index >= 0) {
    decision.history = [
      ...next.decisions[index].history,
      { action: next.decisions[index].action, at: next.decisions[index].at, by: next.decisions[index].by }
    ];
    next.decisions[index] = decision;
  } else {
    next.decisions.push(decision);
  }
  return { state: next, decision };
}

export function reconfirmLink(state, linkId, at = new Date().toISOString(), by = "当前用户") {
  const before = cloneState(state);
  const next = cloneState(state);
  const link = next.links.find(item => item.id === linkId);
  if (!link) throw new Error(`关联不存在：${linkId}`);
  link.lastConfirmedAt = at;
  link.confirmedBy = by;

  for (const entryId of [link.source, link.target]) {
    const entry = next.entries.find(item => item.id === entryId);
    if (entry) {
      const revision = commitRevision(next, entryId, "reconfirm_link", at, by, `复核关联 ${link.id}`);
      revision.impact = compareImpacts(before, next);
    }
  }
  return { state: next, link };
}
