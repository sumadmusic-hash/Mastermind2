import type { ToolDefinition } from '../../types/tool';

const WRITE_TOOLS = new Set([
  'memory_save', 'memory_forget',
  'portfolio_update',
  'schedule_create', 'schedule_remove',
  'calendar_create', 'calendar_remove',
  'export_file',
]);

export function createGuard(origin: 'user' | 'scheduled') {
  return {
    canExecute(tool: ToolDefinition, _origin?: 'user' | 'scheduled'): boolean {
      const effectiveOrigin = _origin || origin;
      if (effectiveOrigin === 'user') return true;
      if (WRITE_TOOLS.has(tool.id) && tool.permissions.includes('write')) {
        return false;
      }
      return true;
    },
    reason: origin === 'scheduled' ? 'Schreib-Tools sind in geplanten Ausführungen nicht erlaubt' : undefined,
  };
}
