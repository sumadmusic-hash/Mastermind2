import type { ToolDefinition, ToolResult } from '../../types/tool';

/**
 * Hilfsfunktionen zum Erzeugen von Tool-Definitionen und -Ergebnissen.
 * Wird von den Tool-Modulen in `src/services/tools/builtin/` genutzt.
 */

// Helper to create a tool definition
export function def(
  id: string, name: string, description: string, category: ToolDefinition['category'],
  inputSchema: Record<string, unknown>, permissions: string[] = []
): ToolDefinition {
  return {
    id, name, description, category,
    inputSchema: { type: 'object', properties: inputSchema, required: Object.keys(inputSchema) },
    version: '1.0.0', enabled: true,
    permissions: permissions as ToolDefinition['permissions'],
    maxDuration: 30000, maxDataSize: 50000, builtin: true,
  };
}

// Helper to create a success result
export function ok(data: unknown, sources?: ToolResult['sources']): ToolResult {
  return { callId: '', toolId: '', success: true, data, sources, duration: 0, cached: false };
}

export function err(error: string): ToolResult {
  return { callId: '', toolId: '', success: false, error, duration: 0, cached: false };
}

// Leeres Ergebnis = expliziter Fehlschlag (verhindert stumme Erfolgs-Meldungen
// und Wiederholungsschleifen des Agenten bei ergebnislosen Anfragen)
export function emptyErr(message: string): ToolResult {
  return err(`${message} – keine Treffer. Bitte nicht dieselbe Anfrage wiederholen, sondern dem Nutzer mitteilen, dass keine Ergebnisse vorliegen.`);
}
