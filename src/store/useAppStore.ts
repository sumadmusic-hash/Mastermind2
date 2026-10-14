import { create } from 'zustand';
import type { AppSettings, ModelSlot } from '../types/provider';
import { DEFAULT_SETTINGS } from '../types/provider';
import { getSettings, saveSettings } from '../services/db/settings';

interface AppState {
  settings: AppSettings;
  loaded: boolean;
  sidebarOpen: boolean;
  currentPage: string;
  loadSettings: () => Promise<void>;
  updateSettings: (changes: Partial<AppSettings>) => Promise<void>;
  setProviderKey: (providerId: string, apiKey: string) => Promise<void>;
  setModelSlots: (slots: ModelSlot[]) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setCurrentPage: (page: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  sidebarOpen: true,
  currentPage: 'chat',

  loadSettings: async () => {
    const settings = await getSettings();
    set({ settings, loaded: true });
  },

  updateSettings: async (changes) => {
    const newSettings = { ...get().settings, ...changes };
    await saveSettings(newSettings);
    set({ settings: newSettings });
  },

  setProviderKey: async (providerId, apiKey) => {
    const settings = get().settings;
    const newSettings = {
      ...settings,
      providers: {
        ...settings.providers,
        [providerId]: { ...settings.providers[providerId], apiKey },
      },
    };
    await saveSettings(newSettings);
    set({ settings: newSettings });
  },

  setModelSlots: async (slots) => {
    const newSettings = { ...get().settings, modelSlots: slots };
    await saveSettings(newSettings);
    set({ settings: newSettings });
  },

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCurrentPage: (page) => set({ currentPage: page }),
}));
