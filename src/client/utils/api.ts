import type { PlanRequest, PlanResponse, SkillResource } from '../types';

const API_BASE = '/api';

export async function getSkills(): Promise<{ skills: any[]; jobs: any[] }> {
  const res = await fetch(`${API_BASE}/skills`);
  if (!res.ok) throw new Error('Failed to fetch skills');
  return res.json();
}

export async function generatePlan(request: PlanRequest): Promise<PlanResponse> {
  const res = await fetch(`${API_BASE}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error('Failed to generate plan');
  return res.json();
}

export async function getResources(skillId: string): Promise<{ resources: SkillResource[] }> {
  const res = await fetch(`${API_BASE}/resources/${skillId}`);
  if (!res.ok) throw new Error('Failed to fetch resources');
  return res.json();
}
