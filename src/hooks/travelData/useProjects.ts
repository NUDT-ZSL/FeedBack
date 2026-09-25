import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TravelProject } from '../../types';
import type { UpdateData } from './types';
import { cascadeDeleteProject } from './cascade';

export function useProjects(updateData: UpdateData) {
  const addProject = useCallback(
    (project: Omit<TravelProject, 'id' | 'createdAt'>) => {
      const newProject: TravelProject = {
        ...project,
        id: uuidv4(),
        createdAt: new Date().toISOString(),
      };
      updateData((prev) => ({
        ...prev,
        projects: [...prev.projects, newProject],
      }));
      return newProject;
    },
    [updateData]
  );

  const updateProject = useCallback(
    (id: string, updates: Partial<TravelProject>) => {
      updateData((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      }));
    },
    [updateData]
  );

  const deleteProject = useCallback(
    (id: string) => {
      updateData((prev) => cascadeDeleteProject(prev, id));
    },
    [updateData]
  );

  return { addProject, updateProject, deleteProject };
}
