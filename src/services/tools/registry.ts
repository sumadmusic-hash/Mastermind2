import type { ToolDefinition, ToolResult, ToolExecuteFn, ToolExecutionContext } from '../../types/tool';
import { LEGACY_ID_MAP } from '../../types/tool';

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, execute: ToolExecuteFn): void {
    if (this.tools.has(definition.id)) {
      console.warn(`Tool "${definition.id}" bereits registriert, wird überschrieben`);
    }
    this.tools.set(definition.id, { definition, execute });
  }

  get(id: string): RegisteredTool | undefined {
    // Try legacy ID resolution
    const resolvedId = LEGACY_ID_MAP[id] || id;
    return this.tools.get(resolvedId);
  }

  getDefinition(id: string): ToolDefinition | undefined {
    const resolvedId = LEGACY_ID_MAP[id] || id;
    return this.tools.get(resolvedId)?.definition;
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  getEnabled(): ToolDefinition[] {
    return this.getAll().filter(t => t.enabled);
  }

  async execute(id: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const resolvedId = LEGACY_ID_MAP[id] || id;
    const tool = this.tools.get(resolvedId);
    if (!tool) {
      return {
        callId: '',
        toolId: resolvedId,
        success: false,
        error: `Tool "${id}" nicht gefunden${LEGACY_ID_MAP[id] ? ` (auch nicht als "${LEGACY_ID_MAP[id]}")` : ''}`,
        duration: 0,
        cached: false,
      };
    }
    if (!tool.definition.enabled) {
      return {
        callId: '',
        toolId: resolvedId,
        success: false,
        error: `Tool "${resolvedId}" ist deaktiviert`,
        duration: 0,
        cached: false,
      };
    }
    const start = Date.now();
    try {
      const result = await tool.execute(args, ctx);
      return { ...result, duration: Date.now() - start };
    } catch (err) {
      return {
        callId: '',
        toolId: resolvedId,
        success: false,
        error: (err as Error).message,
        duration: Date.now() - start,
        cached: false,
      };
    }
  }

  resolveId(id: string): string {
    return LEGACY_ID_MAP[id] || id;
  }
}

export const toolRegistry = new ToolRegistry();
