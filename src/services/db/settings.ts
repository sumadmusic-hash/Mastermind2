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

/**
 * enabledTools auswerten: Die Einstellungen speichern ein Deaktivierungs-Map
 * (ToolId -> false). Fehlt der Eintrag, gilt das Tool als aktiv.
 */
export function isToolEnabledBySettings(
  enabledTools: Record<string, boolean> | undefined,
  toolId: string
): boolean {
  if (!enabledTools) return true;
  const flag = enabledTools[toolId];
  // Nicht gesetzt => Standard "aktiv"; sonst expliziten Wert nehmen.
  return flag === undefined ? true : flag;
}

/**
 * Filtert eine Tool-Liste nach den Nutzereinstellungen (settings.enabledTools).
 * Wird vom Orchestrator vor der Tool-Auswahl und von der Tools-Seite genutzt.
 */
export function applyEnabledTools<T extends { id: string }>(
  tools: T[],
  enabledTools: Record<string, boolean> | undefined
): T[] {
  return tools.filter(t => isToolEnabledBySettings(enabledTools, t.id));
}

export async function setToolEnabled(toolId: string, enabled: boolean): Promise<void> {
  const settings = await getSettings();
  settings.enabledTools = { ...settings.enabledTools, [toolId]: enabled };
  await saveSettings(settings);
}
