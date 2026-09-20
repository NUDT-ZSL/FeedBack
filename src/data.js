/* 内置示例：企业开户长流程表单（字段 / 步骤归属 / 依赖 / 填写要求） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormSample = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sampleForm() {
    return {
      title: '企业开户登记表（示例）',
      stepNames: ['申请人基本信息', '企业信息', '经营与融资', '确认与签署'],
      config: { stepCount: 4, readThreshold: 10, requiredThreshold: 4 },
      fields: [
        { id: 'applicantName', label: '申请人姓名', step: 0, readWeight: 2, required: true },
        { id: 'phone', label: '手机号', step: 0, readWeight: 1, required: true },
        { id: 'idType', label: '证件类型', step: 0, readWeight: 1, required: true },
        { id: 'idNumber', label: '证件号码', step: 0, readWeight: 2, required: true },
        { id: 'birthDate', label: '出生日期', step: 0, readWeight: 1 },
        { id: 'gender', label: '性别', step: 0, readWeight: 1 },
        { id: 'contactAddress', label: '联系地址', step: 0, readWeight: 2, required: true },
        { id: 'companyName', label: '企业名称', step: 1, readWeight: 2, required: true },
        { id: 'creditCode', label: '统一社会信用代码', step: 1, readWeight: 2, required: true },
        { id: 'companyAddress', label: '注册地址', step: 1, readWeight: 2, required: true },
        { id: 'sameAsContact', label: '注册地同联系地址', step: 1, readWeight: 1 },
        { id: 'legalPersonName', label: '法定代表人姓名', step: 1, readWeight: 1, required: true },
        { id: 'legalPersonPhone', label: '法人手机号', step: 1, readWeight: 1 },
        { id: 'annualRevenue', label: '年营业收入', step: 2, readWeight: 3, required: true },
        { id: 'hasLoan', label: '是否存在贷款', step: 2, readWeight: 1, required: true },
        { id: 'loanInstitution', label: '贷款机构', step: 2, readWeight: 2 },
        { id: 'riskLevel', label: '客户风险等级', step: 2, readWeight: 1 },
        { id: 'guarantorName', label: '担保人姓名', step: 2, readWeight: 1, locked: true },
        { id: 'guarantorPhone', label: '担保人电话', step: 3, readWeight: 1, locked: true },
        { id: 'guarantorAgreement', label: '担保人协议签署', step: 3, readWeight: 2 },
        { id: 'confirmInfo', label: '信息核对确认', step: 3, readWeight: 1, required: true },
        { id: 'riskNotice', label: '风险提示告知', step: 3, readWeight: 2, required: true },
        { id: 'declaration', label: '声明签署', step: 3, readWeight: 3, required: true },
        { id: 'nationality', label: '国籍', step: 0, readWeight: 1, excluded: true }
      ],
      dependencies: [
        { id: 'd1', source: 'birthDate', target: 'idNumber', requirement: 'skipIfFilled' },
        { id: 'd2', source: 'sameAsContact', target: 'contactAddress', requirement: 'readOnly' },
        { id: 'd3', source: 'sameAsContact', target: 'companyAddress', requirement: 'hidden' },
        { id: 'd4', source: 'legalPersonPhone', target: 'phone', requirement: 'skipIfFilled' },
        { id: 'd5', source: 'annualRevenue', target: 'riskLevel', requirement: 'readOnly' },
        { id: 'd6', source: 'hasLoan', target: 'riskLevel', requirement: 'required' },
        { id: 'd7', source: 'loanInstitution', target: 'hasLoan', requirement: 'skipIfFilled' },
        { id: 'd8', source: 'guarantorName', target: 'guarantorPhone', requirement: 'required' },
        { id: 'd9', source: 'riskNotice', target: 'guarantorPhone', requirement: 'readOnly' },
        { id: 'd10', source: 'guarantorAgreement', target: 'guarantorName', requirement: 'required' }
      ]
    };
  }

  return { sampleForm: sampleForm };
});
