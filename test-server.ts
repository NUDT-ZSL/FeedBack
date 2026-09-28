import { skills, jobs, getSkillById, getJobById } from './src/server/data';
import { calculateLearningPath } from './src/server/utils/pathCalculator';

console.log('=== 技能节点统计 ===');
console.log(`总技能数: ${skills.length}`);
const domains = ['frontend', 'backend', 'database', 'devops'] as const;
for (const domain of domains) {
  const count = skills.filter(s => s.domain === domain).length;
  console.log(`${domain}: ${count}个`);
}

console.log('\n=== 职位列表 ===');
for (const job of jobs) {
  console.log(`- ${job.title} (${job.id}): ${job.requiredSkills.length}个技能要求, 薪资${job.salaryRange}`);
}

console.log('\n=== 测试学习路径计算 ===');
const testRequest = {
  currentProficiencies: [
    { skillId: 'html5', proficiency: 50 },
    { skillId: 'css3', proficiency: 40 },
    { skillId: 'javascript', proficiency: 30 }
  ],
  targetJobId: 'fullstack',
  maxHoursPerWeek: 15
};

console.log('测试请求:', JSON.stringify(testRequest, null, 2));

calculateLearningPath(testRequest)
  .then(result => {
    console.log('\n=== 计算结果 ===');
    console.log(`目标职位: ${result.jobTitle}`);
    console.log(`缺失技能数: ${result.missingSkills.length}`);
    console.log(`总预估学时: ${result.totalEstimatedHours}小时`);
    console.log(`预估周数: ${result.estimatedWeeks}周`);
    console.log(`学习阶段数: ${result.learningPath.length}`);
    
    console.log('\n--- 缺失技能 ---');
    for (const m of result.missingSkills) {
      console.log(`  ${m.skill.name} (${m.skill.domain}): 当前${m.currentProficiency}% → 需要${m.requiredProficiency}%, 差距${m.gap}%`);
    }
    
    console.log('\n--- 学习路径 ---');
    for (const stage of result.learningPath) {
      const skillNames = stage.skillIds.map(id => getSkillById(id)?.name).join(', ');
      console.log(`  ${stage.title}: ${skillNames}`);
      console.log(`    ${stage.description}`);
      console.log(`    预计${stage.estimatedHours}小时`);
    }
    
    console.log('\n--- 学习建议 ---');
    for (const rec of result.recommendations) {
      console.log(`  - ${rec}`);
    }
    
    console.log('\n✅ 所有测试通过!');
  })
  .catch(error => {
    console.error('❌ 测试失败:', error);
  });
