import axios from 'axios';
import { createSaveQueue } from './saveQueue.ts';
import type { SaveStatus, StatusListener } from './saveQueue.ts';

const listeners = new Set<StatusListener>();

export const exhibitionSaver = createSaveQueue(
  async (id, body) => {
    const res = await axios.put(`/api/exhibitions/${id}`, body);
    return res.data;
  },
  (id, status) => {
    listeners.forEach((listener) => listener(id, status));
  }
);

export function onSaveStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type { SaveStatus };
