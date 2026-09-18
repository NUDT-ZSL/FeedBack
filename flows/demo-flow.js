/*
 * 演示流程：一次性创业补贴申请引导
 * 覆盖：阶段、可跳过步骤、必答/选答问题、问题级依赖、步骤级成立条件、级联失活
 */
const DEMO_FLOW = {
  id: 'startup-subsidy',
  title: '一次性创业补贴申请引导',
  steps: [
    { id: 's-basic', title: '申请人基本信息', phase: '资格核验', skippable: false },
    { id: 's-biz', title: '经营主体信息', phase: '资格核验', skippable: false,
      condition: { question: 'q-type', op: 'in', value: ['个体', '企业'] } },
    { id: 's-venue', title: '经营场所情况', phase: '资格核验', skippable: false,
      condition: { question: 'q-has-venue', op: 'equals', value: true } },
    { id: 's-plan', title: '补贴需求', phase: '申报内容', skippable: false },
    { id: 's-hire', title: '带动就业计划', phase: '申报内容', skippable: false,
      condition: { question: 'q-item', op: 'equals', value: '就业补贴' } },
    { id: 's-extra', title: '补充说明', phase: '申报内容', skippable: true },
    { id: 's-confirm', title: '确认与提交', phase: '提交确认', skippable: false },
  ],
  questions: [
    { id: 'q-name', step: 's-basic', text: '申请人姓名', type: 'text', required: true },
    { id: 'q-type', step: 's-basic', text: '申请人类型', type: 'choice', required: true,
      options: [
        { value: '个人', label: '个人（未注册经营主体）' },
        { value: '个体', label: '个体工商户' },
        { value: '企业', label: '小微企业' },
      ] },
    { id: 'q-first', step: 's-basic', text: '是否首次申请该类补贴', type: 'boolean', required: true },

    { id: 'q-reg-date', step: 's-biz', text: '主体注册是否满 6 个月', type: 'boolean', required: true },
    { id: 'q-staff', step: 's-biz', text: '现有员工人数', type: 'number', required: true,
      dependsOn: [{ question: 'q-type', op: 'equals', value: '企业' }] },
    { id: 'q-has-venue', step: 's-biz', text: '是否有固定经营场所', type: 'boolean', required: true },

    { id: 'q-lease', step: 's-venue', text: '场所租赁剩余期限是否满 1 年', type: 'boolean', required: true },
    { id: 'q-rent', step: 's-venue', text: '月租金（元）', type: 'number', required: true,
      dependsOn: [{ question: 'q-lease', op: 'equals', value: true }] },

    { id: 'q-item', step: 's-plan', text: '拟申请的补贴项目', type: 'choice', required: true,
      options: [
        { value: '设备补贴', label: '设备购置补贴' },
        { value: '场地补贴', label: '场地租赁补贴' },
        { value: '就业补贴', label: '创业带动就业补贴' },
      ] },
    { id: 'q-amount', step: 's-plan', text: '拟申请金额（元）', type: 'number', required: true },

    { id: 'q-hire-count', step: 's-hire', text: '计划新增就业人数', type: 'number', required: true },
    { id: 'q-hire-contract', step: 's-hire', text: '是否承诺签订一年以上劳动合同', type: 'boolean', required: true },

    { id: 'q-note', step: 's-extra', text: '其他需要说明的情况', type: 'text', required: false },

    { id: 'q-truth', step: 's-confirm', text: '本人承诺所填信息真实有效', type: 'boolean', required: true },
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = DEMO_FLOW;
