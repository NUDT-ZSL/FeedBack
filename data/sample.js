/* 由 tools/build-sample.js 生成，请勿手改 */
var SAMPLE_DATA = {
  "initialText": "产品需求文档（V1）\n\n本系统用于管理在线课程的报名与排课。学员可以浏览课程目录，选择感兴趣的课程并提交报名申请。\n\n报名成功后，系统会自动发送确认邮件，并将学员加入对应班级的花名册。\n\n管理员可以手动调整班级容量，必要时将超额报名的学员移入候补名单。\n\n所有操作都会记录审计日志，便于后续追溯。",
  "comments": [
    {
      "id": "m1",
      "content": "这里要不要支持按分类筛选课程？",
      "start": 34,
      "end": 40
    },
    {
      "id": "m2",
      "content": "确认邮件的模板需要法务审核。",
      "start": 68,
      "end": 76
    },
    {
      "id": "m3",
      "content": "班级容量建议做成全局配置，而不是手动调整。",
      "start": 99,
      "end": 107
    },
    {
      "id": "m4",
      "content": "候补名单的排序规则需要明确。",
      "start": 121,
      "end": 125
    },
    {
      "id": "m5",
      "content": "审计日志保留多久？建议至少一年。",
      "start": 134,
      "end": 140
    }
  ],
  "edits": [
    {
      "type": "replace",
      "start": 50,
      "end": 57,
      "text": "提交报名申请。申请提交后可在个人中心查看进度。"
    },
    {
      "type": "replace",
      "start": 88,
      "end": 92,
      "text": "确认短信"
    },
    {
      "type": "delete",
      "start": 110,
      "end": 124
    },
    {
      "type": "move",
      "start": 110,
      "end": 128,
      "to": 112
    },
    {
      "type": "insert",
      "pos": 138,
      "text": "详细的"
    }
  ]
};
if (typeof window !== "undefined") { window.SAMPLE_DATA = SAMPLE_DATA; }
if (typeof module === "object" && module.exports) { module.exports = SAMPLE_DATA; }
