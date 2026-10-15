import { toolRegistry } from '../registry';
import { def, ok } from '../toolHelpers';

toolRegistry.register(
  def('memory_save', 'Erinnerung speichern', 'Information persistent speichern', 'memory',
    { category: { type: 'string', description: 'Kategorie' }, key: { type: 'string', description: 'Schlüssel' }, value: { type: 'string', description: 'Wert' } },
    ['write', 'storage']),
  async (args) => {
    const { category, key, value } = args as { category: string; key: string; value: string };
    const { saveMemory } = await import('../../db/memories');
    await saveMemory(category, key, value);
    return ok({ saved: true, category, key });
  }
);

toolRegistry.register(
  def('memory_recall', 'Erinnerung abrufen', 'Gespeicherte Informationen abrufen', 'memory',
    { category: { type: 'string', description: 'Kategorie (optional)' } },
    ['storage']),
  async (args) => {
    const category = args.category as string | undefined;
    const { recallMemory } = await import('../../db/memories');
    const memories = await recallMemory(category);
    return ok({ memories, count: memories.length });
  }
);

toolRegistry.register(
  def('memory_forget', 'Erinnerung löschen', 'Gespeicherte Information löschen', 'memory',
    { category: { type: 'string', description: 'Kategorie' }, key: { type: 'string', description: 'Schlüssel' } },
    ['write', 'storage']),
  async (args) => {
    const { category, key } = args as { category: string; key: string };
    const { forgetMemory } = await import('../../db/memories');
    await forgetMemory(category, key);
    return ok({ deleted: true, category, key });
  }
);
