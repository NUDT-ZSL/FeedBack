(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SampleData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function addDays(dateText, delta) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  }

  const start = "2026-06-25";
  const anomalies = {
    35: -0.24, 36: -0.29, 37: -0.21,
    51: 0.18, 52: 0.23, 53: 0.16,
    74: -0.18, 75: -0.27, 76: -0.23,
    82: 0.21, 83: 0.27, 85: 0.19,
    4: 0.10, 25: 0.11, 60: 0.09,
  };
  const missingRows = new Set([36, 76, 84]);
  const duplicateRows = new Map([[37, -700], [53, 520]]);

  function metricRows() {
    const rows = [{ date: "date", metric_name: "metric_name", value: "value" }];
    for (let i = 0; i < 90; i += 1) {
      const date = addDays(start, i);
      let value = 12000
        + 320 * Math.sin((i % 7) / 6 * Math.PI * 2)
        + Math.round(((i * 37) % 17) * 18 - 144);
      if (anomalies[i]) value = Math.round(value * (1 + anomalies[i]));
      if (!missingRows.has(i)) rows.push({ date, metric_name: "订单量", value: String(value) });
      if (duplicateRows.has(i)) {
        rows.push({ date, metric_name: "订单量", value: String(value + duplicateRows.get(i)) });
      }
    }
    return rows;
  }

  const eventList = [
    [29, "服务发布", "支付服务常规版本发布，灰度比例10%"],
    [34, "支付故障", "第三方支付通道超时，部分订单无法提交"],
    [35, "支付故障", "支付通道仍在切换恢复"],
    [50, "营销Push", "暑期满减活动推送"],
    [68, "服务发布", "推荐服务扩容发布"],
    [73, "优惠券活动", "会员专属优惠券发放"],
    [74, "服务发布", "订单服务紧急发布，错误率升高"],
    [74, "极端天气", "华东强降雨影响部分城市履约"],
    [81, "营销Push", "开学季APP弹窗与短信触达"],
    [82, "营销Push", "活动落地页二次推送"],
    [4, "营销Push", "小规模会员Push"],
    [4, "优惠券活动", "新人小额券包"],
    [25, "营销Push", "周末专题Push"],
    [60, "营销Push", "沉默召回Push"],
    [60, "优惠券活动", "召回优惠券"],
  ];

  function eventRows() {
    const rows = [{ date: "date", event_type: "event_type", description: "description" }];
    eventList.forEach(([offset, type, description]) => {
      rows.push({ date: addDays(start, offset), event_type: type, description });
    });
    rows.push({ date: addDays(start, 82), event_type: "营销Push", description: "活动落地页二次推送" });
    return rows;
  }

  function toCsv(rows) {
    const headers = Object.values(rows[0]);
    const body = rows.slice(1).map((row) => headers.map((header) => {
      const value = String(row[header] ?? "");
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(","));
    return [headers.join(","), ...body].join("\n");
  }

  return {
    metricsCsv: () => toCsv(metricRows()),
    eventsCsv: () => toCsv(eventRows()),
  };
});
