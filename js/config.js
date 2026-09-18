/**
 * 示例引导配置：一次性创业/就业补贴自助申报
 *
 * 配置结构：
 *   stages: [{id, title}]                 阶段分组
 *   steps: [{
 *     id, title, stage, skippable,
 *     condition?(ctx => boolean),         步骤成立条件
 *     dependsOn?: [questionId],           条件中引用的问题必须在此显式声明
 *     questions: [{
 *       id, title, type, options?, optional?, description?,
 *       condition?(ctx => boolean), dependsOn?: [questionId]
 *     }]
 *   }]
 *
 * 依赖只能指向「此前步骤」或「同一步骤中排在前面」的问题，且不得成环。
 * 浏览器挂 window.DEMO_CONFIG；Node 下 module.exports。
 */
(function (global) {
  'use strict';

  const CONFIG = {
    title: '一次性就业补贴 · 自助申报引导',
    stages: [
      { id: 'prepare', title: '申报准备' },
      { id: 'declare', title: '补贴项目' },
      { id: 'finish', title: '收尾与提交' }
    ],
    steps: [
      {
        id: 's_identity',
        stage: 'prepare',
        title: '申请人身份',
        description: '先确认申报主体类型，后续要填写的信息表会据此切换。',
        questions: [
          {
            id: 'applicant_type',
            title: '您以什么身份申报？',
            type: 'radio',
            options: [
              { value: 'person', label: '个人（创业者 / 灵活就业人员）' },
              { value: 'enterprise', label: '企业' },
              { value: 'institution', label: '事业单位 / 社会组织' }
            ]
          }
        ]
      },
      {
        id: 's_basic',
        stage: 'prepare',
        title: '基本信息',
        description: '上一题选择不同，这里出现的表单也不同；改回原选择时，已填内容会原样恢复。',
        questions: [
          {
            id: 'person_name',
            title: '申请人姓名',
            type: 'text',
            dependsOn: ['applicant_type'],
            condition: (a) => a.applicant_type === 'person'
          },
          {
            id: 'person_id',
            title: '身份证号',
            type: 'text',
            dependsOn: ['applicant_type'],
            condition: (a) => a.applicant_type === 'person'
          },
          {
            id: 'org_name',
            title: '单位名称',
            type: 'text',
            dependsOn: ['applicant_type'],
            condition: (a) => a.applicant_type === 'enterprise' || a.applicant_type === 'institution'
          },
          {
            id: 'org_code',
            title: '统一社会信用代码',
            type: 'text',
            dependsOn: ['applicant_type'],
            condition: (a) => a.applicant_type === 'enterprise' || a.applicant_type === 'institution'
          }
        ]
      },
      {
        id: 's_subsidy',
        stage: 'declare',
        title: '选择补贴项目',
        description: '三类补贴只能选一类；切换项目后，原专项步骤的填写内容会保留并暂时收起。',
        questions: [
          {
            id: 'subsidy_type',
            title: '本次申报的补贴项目',
            type: 'radio',
            options: [
              { value: 'startup', label: '一次性创业补贴' },
              { value: 'hire', label: '吸纳就业补贴' },
              { value: 'training', label: '职业培训补贴' }
            ]
          }
        ]
      },
      {
        id: 's_startup',
        stage: 'declare',
        title: '创业补贴专项信息',
        description: '仅「个人」申报「一次性创业补贴」时需要填写。',
        dependsOn: ['applicant_type', 'subsidy_type'],
        condition: (a) => a.applicant_type === 'person' && a.subsidy_type === 'startup',
        questions: [
          { id: 'license_no', title: '营业执照（或其他创业证明）编号', type: 'text' },
          { id: 'startup_date', title: '创业（注册）日期', type: 'date' },
          {
            id: 'hire_plan',
            title: '创业后是否已招用或计划招用员工？',
            type: 'boolean'
          },
          {
            id: 'hire_count',
            title: '拟招用 / 已招用人数',
            type: 'number',
            dependsOn: ['hire_plan'],
            condition: (a) => a.hire_plan === true
          }
        ]
      },
      {
        id: 's_hire',
        stage: 'declare',
        title: '吸纳就业补贴专项信息',
        description: '申报「吸纳就业补贴」时填写。注意下方三题存在连带关系：改了前面的数字，后面的题会要求重新确认。',
        dependsOn: ['subsidy_type'],
        condition: (a) => a.subsidy_type === 'hire',
        questions: [
          { id: 'employee_total', title: '当前员工总数（人）', type: 'number' },
          {
            id: 'new_hires',
            title: '本次申报期内新招用人数（人）',
            type: 'number',
            dependsOn: ['employee_total'],
            condition: (a) => Number(a.employee_total) >= 1
          },
          {
            id: 'avg_salary',
            title: '新招用人员月均工资（元）',
            type: 'number',
            dependsOn: ['new_hires'],
            condition: (a) => Number(a.new_hires) >= 1
          }
        ]
      },
      {
        id: 's_training',
        stage: 'declare',
        title: '培训补贴专项信息',
        description: '申报「职业培训补贴」时填写。',
        dependsOn: ['subsidy_type'],
        condition: (a) => a.subsidy_type === 'training',
        questions: [
          { id: 'course_name', title: '培训项目 / 课程名称', type: 'text' },
          { id: 'training_hours', title: '培训总课时（小时）', type: 'number' },
          {
            id: 'completed',
            title: '是否已取得结业（合格）证明？',
            type: 'boolean'
          },
          {
            id: 'cert_no',
            title: '结业证明编号',
            type: 'text',
            dependsOn: ['completed'],
            condition: (a) => a.completed === true
          }
        ]
      },
      {
        id: 's_bank',
        stage: 'finish',
        title: '补贴拨付账户',
        questions: [
          { id: 'account_name', title: '开户人 / 单位名称', type: 'text' },
          {
            id: 'account_bank',
            title: '开户银行',
            type: 'select',
            options: [
              { value: '', label: '请选择' },
              { value: 'ICBC', label: '工商银行' },
              { value: 'CCB', label: '建设银行' },
              { value: 'ABC', label: '农业银行' },
              { value: 'BOC', label: '中国银行' },
              { value: 'OTHER', label: '其他银行' }
            ]
          },
          { id: 'account_no', title: '银行账号', type: 'text' }
        ]
      },
      {
        id: 's_extra',
        stage: 'finish',
        title: '补充材料（可跳过）',
        skippable: true,
        description: '没有补充材料时可直接跳过本步骤；之后随时可以回来补填。',
        questions: [
          { id: 'contact_phone', title: '联系电话（选填）', type: 'text', optional: true },
          { id: 'remark', title: '需要补充说明的情况（选填）', type: 'textarea', optional: true }
        ]
      },
      {
        id: 's_submit',
        stage: 'finish',
        title: '确认与提交',
        questions: [
          {
            id: 'promise',
            title: '我承诺以上填报内容真实、准确、完整，如有虚假愿承担相应责任。',
            type: 'boolean'
          }
        ]
      }
    ]
  };

  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = CONFIG;
  } else {
    global.DEMO_CONFIG = CONFIG;
  }
})(typeof self !== 'undefined' ? self : this);
