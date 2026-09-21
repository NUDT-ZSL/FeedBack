(() => {
  "use strict";

  const PAGE_SIZE = 4;

  const records = [
    { id: "atlas", type: "doc", title: "Atlas 部署手册", summary: "离线边缘节点部署、巡检与回滚。" },
    { id: "borealis", type: "doc", title: "Borealis 数据字典", summary: "字段血缘、质量阈值和口径说明。" },
    { id: "canyon", type: "doc", title: "Canyon 故障复盘", summary: "慢查询导致的排队与恢复时间线。" },
    { id: "delta", type: "doc", title: "Delta 检索白皮书", summary: "分批、快照与一致性阅读模型。" },
    { id: "ember", type: "media", title: "Ember 演示视频", summary: "实时筛选、切页和冲突处理演示。" },
    { id: "fjord", type: "media", title: "Fjord 架构图", summary: "浏览器本地缓存和异步源的关系。" },
    { id: "granite", type: "media", title: "Granite 培训音频", summary: "运营值班检索流程讲解。" },
    { id: "harbor", type: "dataset", title: "Harbor 指标样本", summary: "批次延迟、取消率和命中率。" },
    { id: "ivory", type: "dataset", title: "Ivory 客户数据", summary: "区域、行业与活跃度切片。" },
    { id: "jasper", type: "dataset", title: "Jasper 事件流", summary: "审计事件和终端确认记录。" },
    { id: "kestrel", type: "doc", title: "Kestrel 权限矩阵", summary: "检索、裁决和恢复操作权限。" },
    { id: "lumen", type: "media", title: "Lumen 现场截图", summary: "过期提示与上下文抽屉截图。" }
  ];

  function queryMatches(record, query) {
    const haystack = `${record.id} ${record.title} ${record.summary}`.toLocaleLowerCase("zh-CN");
    return query.split(/\s+/).every((word) => !word || haystack.includes(word.toLocaleLowerCase("zh-CN")));
  }

  function alternativeTitle(record) {
    return `${record.title}（修订版本）`;
  }

  function buildBatches(context) {
    const { query, type, page } = context;
    const startIndex = (page - 1) * PAGE_SIZE;
    const matched = records
      .filter((record) => type === "all" || record.type === type)
      .filter((record) => queryMatches(record, query))
      .slice(startIndex, startIndex + PAGE_SIZE);

    return matched.map((record, index) => ({
      batchId: `p${page}-b${index + 1}`,
      items: [{
        position: index + 1,
        id: record.id,
        type: record.type,
        title: record.title,
        summary: record.summary,
        contentKey: `${record.id}:v1`
      }]
    }));
  }

  function buildConflictBatch(context, batches) {
    const record = records.find((item) => item.id === batches[0].items[0].id);
    return {
      batchId: `p${context.page}-conflict`,
      items: [{
        position: 1,
        id: record.id,
        type: record.type,
        title: alternativeTitle(record),
        summary: `${record.summary} 修订版更新了标题和摘要。`,
        contentKey: `${record.id}:revised-${context.page}`,
        note: "同一位置、不同内容的后到达批次"
      }]
    };
  }

  function createMockSource(options = {}) {
    const delay = options.delay ?? 500;
    const variance = options.variance ?? 250;
    return {
      start({ context, onStart, onBatch, onComplete, onError }) {
        const batches = buildBatches(context);
        const includeConflict = batches.length > 0
          && options.shouldEmitConflict
          && options.shouldEmitConflict(context);
        onStart(batches.length + (includeConflict ? 1 : 0));
        if (includeConflict) {
          batches.push(buildConflictBatch(context, batches));
        }
        batches.forEach((batch, index) => {
          setTimeout(() => {
            try {
              onBatch(batch);
              if (index === batches.length - 1) onComplete();
            } catch (error) {
              onError(error.message);
            }
          }, delay + index * variance);
        });
        if (batches.length === 0) setTimeout(onComplete, delay);
      }
    };
  }

  const api = { records, buildBatches, createMockSource, PAGE_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.MockSearch = api;
})();
