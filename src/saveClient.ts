import axios from 'axios';
import { createSaveManager } from './saveManager';

/**
 * Single per-exhibition save chain shared by builder and preview pages
 * (same SPA module instance), so navigation waits for in-flight saves.
 */
export const exhibitionSaves = createSaveManager(async (exhibitionId, payload) => {
  const res = await axios.put(`/api/exhibitions/${exhibitionId}`, payload);
  return res.data;
});
