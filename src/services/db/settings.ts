import { db } from './schema';
import type { AppSettings } from '../../types/provider';
import { DEFAULT_SETTINGS } from '../../types/provider';

export async function getSettings(): Promise<AppSettings> {
  const settings = await db.settings.get('main');
  return settings || { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ ...settings, id: 'main' });
}

export async function updateProvider(
  providerId: string,
  changes: Partial<AppSettings['providers'][string]>
): Promise<void> {
  const settings = await getSettings();
  if (settings.providers[providerId]) {
    settings.providers[providerId] = { ...settings.providers[providerId], ...changes };
    await saveSettings(settings);
  }
}

export async function updateModelSlots(slots: AppSettings['modelSlots']): Promise<void> {
  const settings = await getSettings();
  settings.modelSlots = slots;
  await saveSettings(settings);
}
