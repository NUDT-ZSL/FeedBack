import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Member } from '../../types';
import type { UpdateData } from './types';

export function useMembers(updateData: UpdateData) {
  const addMember = useCallback(
    (member: Omit<Member, 'id'>) => {
      const newMember: Member = {
        ...member,
        id: uuidv4(),
      };
      updateData((prev) => ({
        ...prev,
        members: [...prev.members, newMember],
      }));
      return newMember;
    },
    [updateData]
  );

  const updateMember = useCallback(
    (id: string, updates: Partial<Member>) => {
      updateData((prev) => ({
        ...prev,
        members: prev.members.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      }));
    },
    [updateData]
  );

  const deleteMember = useCallback(
    (id: string) => {
      updateData((prev) => ({
        ...prev,
        members: prev.members.filter((m) => m.id !== id),
      }));
    },
    [updateData]
  );

  return { addMember, updateMember, deleteMember };
}
