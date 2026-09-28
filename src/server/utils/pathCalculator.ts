import type { SkillNode, JobRequirement, PlanRequest, PlanResponse, PathStage } from '../types';
import { skills, getSkillById, getJobById } from '../data';

const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const topologicalSort = (skillIds: string[]): string[] => {
  const visited = new Set<string>();
  const result: string[] = [];
  const skillMap = new Map(skills.map(s => [s.id, s]));

  const visit = (skillId: string, ancestors: Set<string>) => {
    if (visited.has(skillId)) return;
    if (ancestors.has(skillId)) {
      throw new Error(`Circular dependency detected: ${skillId}`);
    }

    ancestors.add(skillId);
    const skill = skillMap.get(skillId);
    if (skill) {
      for (const dep of skill.dependencies) {
        if (skillIds.includes(dep) || skillMap.has(dep)) {
          visit(dep, ancestors);
        }
      }
    }
    ancestors.delete(skillId);

    visited.add(skillId);
    result.push(skillId);
  };

  for (const skillId of skillIds) {
    visit(skillId, new Set());
  }

  return result;
};

const getSkillEstimatedHours = (gap: number): number => {
  if (gap <= 20) return 15;
  if (gap <= 40) return 30;
  if (gap <= 60) return 50;
  return 75;
};

const getStageTitle = (stage: number, domains: Set<string>): string => {
  const domainTitles: Record<string, string> = {
    frontend: '前端基础',
    backend: '后端开发',
    database: '数据库',
    devops: 'DevOps'
  };

  if (domains.size === 1) {
    const domain = Array.from(domains)[0];
    return `第${stage}阶段：${domainTitles[domain] || domain}进阶`;
  }
  if (stage === 1) return '第1阶段：基础入门';
  if (stage === 2) return '第2阶段：核心技术';
  return `第${stage}阶段：综合提升`;
};

const getStageDescription = (stage: number, skillCount: number): string => {
  if (stage === 1) {
    return `掌握${skillCount}个基础技能，建立完整的知识体系框架，为后续学习打下坚实基础。`;
  }
  if (stage === 2) {
    return `深入学习${skillCount}个核心技术，通过实战项目提升动手能力，达到企业级应用水平。`;
  }
  return `攻克${skillCount}个高级技能，学习最佳实践和架构设计，具备独立完成复杂项目的能力。`;
};

export const calculateLearningPath = async (
  request: PlanRequest
): Promise<PlanResponse> => {
  await delay(200 + Math.random() * 200);

  const { currentProficiencies, targetJobId, maxHoursPerWeek = 10 } = request;

  const job = getJobById(targetJobId);
  if (!job) {
    throw new Error(`Job not found: ${targetJobId}`);
  }

  const proficiencyMap = new Map(
    currentProficiencies.map(p => [p.skillId, p.proficiency])
  );

  const missingSkills: PlanResponse['missingSkills'] = [];
  const missingSkillIds: string[] = [];

  for (const req of job.requiredSkills) {
    const skill = getSkillById(req.skillId);
    if (!skill) continue;

    const currentProficiency = proficiencyMap.get(req.skillId) ?? 0;
    const gap = Math.max(0, req.minProficiency - currentProficiency);

    if (gap > 0) {
      missingSkills.push({
        skill,
        currentProficiency,
        requiredProficiency: req.minProficiency,
        gap
      });
      missingSkillIds.push(req.skillId);
    }
  }

  const allRequiredSkillIds = new Set([
    ...missingSkillIds,
    ...job.requiredSkills.map(r => r.skillId)
  ]);

  const addDependencies = (skillId: string, collected: Set<string>) => {
    const skill = getSkillById(skillId);
    if (!skill) return;

    for (const dep of skill.dependencies) {
      if (!collected.has(dep)) {
        collected.add(dep);
        addDependencies(dep, collected);
      }
    }
  };

  const allSkillIds = new Set(missingSkillIds);
  for (const skillId of missingSkillIds) {
    addDependencies(skillId, allSkillIds);
  }

  const missingWithDependencies: PlanResponse['missingSkills'] = [];
  for (const skillId of Array.from(allSkillIds)) {
    const skill = getSkillById(skillId);
    if (!skill) continue;

    const existing = missingSkills.find(m => m.skill.id === skillId);
    if (existing) {
      missingWithDependencies.push(existing);
    } else {
      const currentProficiency = proficiencyMap.get(skillId) ?? 0;
      const jobReq = job.requiredSkills.find(r => r.skillId === skillId);
      const requiredProficiency = jobReq?.minProficiency ?? skill.proficiencyThreshold;
      const gap = Math.max(0, requiredProficiency - currentProficiency);

      if (gap > 0) {
        missingWithDependencies.push({
          skill,
          currentProficiency,
          requiredProficiency,
          gap
        });
        if (!missingSkillIds.includes(skillId)) {
          missingSkillIds.push(skillId);
        }
      }
    }
  }

  const sortedSkillIds = topologicalSort(
    missingWithDependencies.map(m => m.skill.id)
  );

  const stages: PathStage[] = [];
  const skillsPerStage = Math.max(3, Math.ceil(sortedSkillIds.length / 3));
  let currentStage = 1;
  let currentStageSkills: string[] = [];
  let currentStageHours = 0;
  const domainsInStage = new Set<string>();

  for (const skillId of sortedSkillIds) {
    const missing = missingWithDependencies.find(m => m.skill.id === skillId);
    if (!missing) continue;

    const skillHours = getSkillEstimatedHours(missing.gap);

    if (currentStageSkills.length >= skillsPerStage) {
      stages.push({
        stage: currentStage,
        title: getStageTitle(currentStage, domainsInStage),
        skillIds: [...currentStageSkills],
        estimatedHours: currentStageHours,
        description: getStageDescription(currentStage, currentStageSkills.length)
      });
      currentStage++;
      currentStageSkills = [];
      currentStageHours = 0;
      domainsInStage.clear();
    }

    currentStageSkills.push(skillId);
    currentStageHours += skillHours;
    domainsInStage.add(missing.skill.domain);
  }

  if (currentStageSkills.length > 0) {
    stages.push({
      stage: currentStage,
      title: getStageTitle(currentStage, domainsInStage),
      skillIds: [...currentStageSkills],
      estimatedHours: currentStageHours,
      description: getStageDescription(currentStage, currentStageSkills.length)
    });
  }

  const totalEstimatedHours = stages.reduce((sum, s) => sum + s.estimatedHours, 0);
  const estimatedWeeks = Math.ceil(totalEstimatedHours / maxHoursPerWeek);

  const recommendations: string[] = [
    '建议每周保持固定的学习时间，避免中断学习节奏',
    '每个技能学习完成后，通过实战项目巩固所学知识',
    '优先学习基础技能，再逐步深入到高级主题',
    '利用提供的学习资源，结合官方文档进行系统学习',
    '加入技术社区，与其他开发者交流学习心得'
  ];

  if (job.preferredSkills && job.preferredSkills.length > 0) {
    const preferredNames = job.preferredSkills
      .map(id => getSkillById(id)?.name)
      .filter(Boolean) as string[];
    if (preferredNames.length > 0) {
      recommendations.push(
        `完成必修技能后，建议学习加分技能：${preferredNames.join('、')}`
      );
    }
  }

  return {
    jobTitle: job.title,
    missingSkills: missingWithDependencies.sort((a, b) => {
      const aIndex = sortedSkillIds.indexOf(a.skill.id);
      const bIndex = sortedSkillIds.indexOf(b.skill.id);
      return aIndex - bIndex;
    }),
    learningPath: stages,
    totalEstimatedHours,
    estimatedWeeks,
    recommendations
  };
};

export const getMissingSkills = (
  currentProficiencies: PlanRequest['currentProficiencies'],
  targetJobId: string
): PlanResponse['missingSkills'] => {
  const job = getJobById(targetJobId);
  if (!job) return [];

  const proficiencyMap = new Map(
    currentProficiencies.map(p => [p.skillId, p.proficiency])
  );

  const result: PlanResponse['missingSkills'] = [];

  for (const req of job.requiredSkills) {
    const skill = getSkillById(req.skillId);
    if (!skill) continue;

    const currentProficiency = proficiencyMap.get(req.skillId) ?? 0;
    const gap = Math.max(0, req.minProficiency - currentProficiency);

    if (gap > 0) {
      result.push({
        skill,
        currentProficiency,
        requiredProficiency: req.minProficiency,
        gap
      });
    }
  }

  return result;
};
