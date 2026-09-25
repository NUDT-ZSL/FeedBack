import type { TravelData } from '../../types';

// Cascading cleanup for deleting a project: removes the project itself
// plus every member, itinerary item, budget split and packing item that
// belongs to it. Entities of other projects are left untouched, and
// calling it with an unknown id is a no-op.
export function cascadeDeleteProject(prev: TravelData, projectId: string): TravelData {
  return {
    ...prev,
    projects: prev.projects.filter((p) => p.id !== projectId),
    members: prev.members.filter((m) => m.projectId !== projectId),
    itineraryItems: prev.itineraryItems.filter((i) => i.projectId !== projectId),
    budgetSplits: prev.budgetSplits.filter((b) => b.projectId !== projectId),
    packingItems: prev.packingItems.filter((p) => p.projectId !== projectId),
  };
}
