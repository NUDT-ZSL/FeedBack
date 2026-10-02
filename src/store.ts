import { create } from 'zustand';
import axios from 'axios';
import {
  SaltCertificate,
  IronCertificate,
  InspectionLog,
  IronCertChange,
  DailyStats,
  MonthlyReport,
  SearchResult,
} from './types';

interface AppState {
  saltCerts: SaltCertificate[];
  ironCerts: IronCertificate[];
  inspectionLogs: InspectionLog[];
  ironCertChanges: IronCertChange[];
  dailyStats: DailyStats[];
  currentInspecting: SaltCertificate | null;
  selectedIronCert: IronCertificate | null;
  searchResults: SearchResult[];
  sortOrder: 'asc' | 'desc';
  isReportOpen: boolean;
  reportData: MonthlyReport | null;

  fetchSaltCerts: () => Promise<void>;
  fetchIronCerts: () => Promise<void>;
  addSaltCert: (cert: Omit<SaltCertificate, 'id' | 'status'>) => Promise<void>;
  inspectSaltCert: (certId: string, result: 'verified' | 'rejected', inspector: string) => Promise<void>;
  toggleIronCertDetail: (certId?: string) => void;
  searchRecords: (query: string, sortOrder: 'asc' | 'desc') => void;
  generateReport: (month: string) => Promise<void>;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

const STORAGE_KEY = 'salt-iron-regulatory-data';

const playInspectionSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.warn('Audio not supported');
  }
};

export const useAppStore = create<AppState>((set, get) => ({
  saltCerts: [],
  ironCerts: [],
  inspectionLogs: [],
  ironCertChanges: [],
  dailyStats: [],
  currentInspecting: null,
  selectedIronCert: null,
  searchResults: [],
  sortOrder: 'desc',
  isReportOpen: false,
  reportData: null,

  fetchSaltCerts: async () => {
    try {
      const response = await axios.get<SaltCertificate[]>('/api/salt-certificates');
      set({ saltCerts: response.data });
      get().saveToStorage();
    } catch (error) {
      console.error('Failed to fetch salt certificates:', error);
    }
  },

  fetchIronCerts: async () => {
    try {
      const response = await axios.get<IronCertificate[]>('/api/iron-certificates');
      set({ ironCerts: response.data });
      get().saveToStorage();
    } catch (error) {
      console.error('Failed to fetch iron certificates:', error);
    }
  },

  addSaltCert: async (cert) => {
    try {
      const response = await axios.post<SaltCertificate>('/api/salt-certificates', cert);
      set((state) => ({
        saltCerts: [...state.saltCerts, response.data],
      }));
      get().saveToStorage();
    } catch (error) {
      console.error('Failed to add salt certificate:', error);
    }
  },

  inspectSaltCert: async (certId, result, inspector) => {
    try {
      const updatedCert = await axios.put<SaltCertificate>(`/api/salt-certificates/${certId}/inspect`, {
        result,
        inspector,
      });

      const log: InspectionLog = {
        id: `log-${Date.now()}`,
        saltCertId: certId,
        action: `Inspection ${result}`,
        operator: inspector,
        timestamp: new Date().toISOString(),
        result,
      };

      set((state) => ({
        saltCerts: state.saltCerts.map((c) =>
          c.id === certId ? { ...updatedCert.data, inspectedAt: new Date().toISOString(), inspector } : c
        ),
        inspectionLogs: [...state.inspectionLogs, log],
        currentInspecting: null,
      }));

      playInspectionSound();
      get().saveToStorage();
    } catch (error) {
      console.error('Failed to inspect salt certificate:', error);
    }
  },

  toggleIronCertDetail: (certId) => {
    if (!certId) {
      set({ selectedIronCert: null });
      return;
    }
    const cert = get().ironCerts.find((c) => c.id === certId);
    set({ selectedIronCert: cert || null });
  },

  searchRecords: (query, sortOrder) => {
    const { saltCerts, ironCerts } = get();
    const lowerQuery = query.toLowerCase();

    const history = localStorage.getItem('search-history');
    const searchHistory: SearchResult[] = history ? JSON.parse(history) : [];

    const matchedSaltCerts = saltCerts.filter((cert) =>
      cert.id.toLowerCase().includes(lowerQuery)
    );

    const matchedIronCerts = ironCerts.filter((cert) =>
      cert.holderName.toLowerCase().includes(lowerQuery)
    );

    const results: SearchResult[] = [
      ...matchedSaltCerts.map((cert) => ({
        type: 'salt' as const,
        data: cert,
        timestamp: new Date().toISOString(),
      })),
      ...matchedIronCerts.map((cert) => ({
        type: 'iron' as const,
        data: cert,
        timestamp: new Date().toISOString(),
      })),
    ];

    const sortedResults = results.sort((a, b) => {
      const aId = 'id' in a.data ? a.data.id : a.data.holderName;
      const bId = 'id' in b.data ? b.data.id : b.data.holderName;
      return sortOrder === 'asc' ? aId.localeCompare(bId) : bId.localeCompare(aId);
    });

    const newHistory = [...sortedResults, ...searchHistory].slice(0, 50);
    localStorage.setItem('search-history', JSON.stringify(newHistory));

    set({ searchResults: sortedResults, sortOrder });
  },

  generateReport: async (month) => {
    try {
      const response = await axios.get<MonthlyReport>(`/api/report?month=${month}`);
      set({ reportData: response.data, isReportOpen: true });
    } catch (error) {
      console.error('Failed to generate report:', error);
    }
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set({
          saltCerts: data.saltCerts || [],
          ironCerts: data.ironCerts || [],
          inspectionLogs: data.inspectionLogs || [],
          ironCertChanges: data.ironCertChanges || [],
          dailyStats: data.dailyStats || [],
        });
      }
    } catch (error) {
      console.error('Failed to load from storage:', error);
    }
  },

  saveToStorage: () => {
    try {
      const { saltCerts, ironCerts, inspectionLogs, ironCertChanges, dailyStats } = get();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          saltCerts,
          ironCerts,
          inspectionLogs,
          ironCertChanges,
          dailyStats,
        })
      );
    } catch (error) {
      console.error('Failed to save to storage:', error);
    }
  },
}));
