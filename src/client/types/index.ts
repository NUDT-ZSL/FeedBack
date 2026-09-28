export type SkillDomain = 'frontend' | 'backend' | 'database' | 'devops';

export interface SkillResource {
  id: string;
  title: string;
  type: 'video' | 'article' | 'course' | 'book';
  url: string;
  duration?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface SkillNode {
  id: string;
  name: string;
  domain: SkillDomain;
  proficiency: number;
  dependencies: string[];
  subSkills: string[];
  proficiencyThreshold: number;
  description: string;
  color: string;
  resources: SkillResource[];
}

export interface JobRequirement {
  id: string;
  title: string;
  description: string;
  requiredSkills: { skillId: string; minProficiency: number }[];
  preferredSkills?: string[];
  salaryRange: string;
}

export type StageStatus = 'not-started' | 'in-progress' | 'completed';

export interface PathStage {
  id: string;
  skillId: string;
  skillName: string;
  estimatedDuration: number;
  resources: SkillResource[];
  status: StageStatus;
  order: number;
}

export interface PlanRequest {
  targetJobId: string;
  currentProficiencies: { skillId: string; proficiency: number }[];
}

export interface PlanResponse {
  jobTitle: string;
  totalEstimatedHours: number;
  stages: PathStage[];
  missingSkills: string[];
}

export interface DomainColorMap {
  frontend: string;
  backend: string;
  database: string;
  devops: string;
}

export const DOMAIN_COLORS: DomainColorMap = {
  frontend: '#3b82f6',
  backend: '#22c55e',
  database: '#f97316',
  devops: '#a855f7',
};
