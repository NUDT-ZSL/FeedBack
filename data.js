(function (root) {
  "use strict";

  var TYPES = {
    all: ["doc", "image", "log", "doc"],
    doc: ["doc", "doc", "doc", "doc"],
    image: ["image", "image", "image", "image"],
    log: ["log", "log", "log", "log"]
  };

  function typeLabel(type) {
    return { doc: "文档", image: "图片", log: "日志" }[type] || type;
  }

  function makeItem(input, batchIndex, itemIndex) {
    var base = (input.page - 1) * 12 + batchIndex * 3 + itemIndex;
    var locationId = "loc-" + String(base + 1).padStart(3, "0");
    var type = TYPES[input.filter] ? TYPES[input.filter][batchIndex] : "doc";
    var keyword = input.query || "本地索引";
    return {
      id: locationId,
      locationId: locationId,
      type: type,
      title: keyword + " 结果 " + (base + 1),
      content: {
        summary: "位置 " + locationId + "：来自本地离线索引的" + typeLabel(type) + "片段。",
                        updatedAt: "2026-09-2" + ((batchIndex % 3) + 1) + " 10:0" + itemIndex,
                        score: 98 - ((batchIndex + itemIndex) % 7)
      }
    };
  }

  function makeBatch(input, index) {
    var items = [makeItem(input, index, 0), makeItem(input, index, 1)];
    if (index === 1) items[1] = makeItem(input, 0, 0);
    return {
      id: "batch-" + input.page + "-" + index,
      label: "第 " + (index + 1) + " 批",
      source: "local-index",
      items: items
    };
  }

  function makeConflictBatch(input) {
    var normal = makeItem(input, 0, 0);
    return {
      id: "conflict-" + Date.now().toString(36),
      label: "矛盾样本批次",
      source: "conflict-sample",
      items: [
        {
          id: normal.locationId,
          locationId: normal.locationId,
          type: "doc",
          title: input.query + " 结果 1（另一索引版本）",
          content: {
            summary: "同一位置返回了不同摘要：此内容来自稍后快照，可用于演示裁决。",
            updatedAt: "2026-09-22 10:59",
            score: 73
          }
        }
      ]
    };
  }

  root.SearchSimulator = {
    totalBatches: 4,
    typeLabel: typeLabel,
    makeBatch: makeBatch,
    makeConflictBatch: makeConflictBatch
  };
})(typeof window !== "undefined" ? window : globalThis);
