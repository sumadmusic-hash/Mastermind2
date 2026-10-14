import type { ToolDefinition, ToolResult, ToolExecutionContext } from '../../types/tool';
import { toolRegistry } from '../tools/registry';
import { validateToolArgs, coerceToolArguments } from '../tools/validation';
import { createGuard } from '../tools/guard';
import { compactToolData } from './resultCompactor';

// Dedup cache: same tool + same args in same turn → cached result
const dedupCache = new Map<string, ToolResult>();

function makeDedupKey(toolId: string, args: Record<string, unknown>): string {
  return `${toolId}:${JSON.stringify(args)}`;
}

export function clearDedupCache(): void {
  dedupCache.clear();
}

export async function dispatchToolCall(
  toolId: string,
  rawArgs: unknown,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const resolvedId = toolRegistry.resolveId(toolId);
  const definition = toolRegistry.getDefinition(resolvedId);

  if (!definition) {
    return {
      callId: '',
      toolId: resolvedId,
      success: false,
      error: `Tool "${toolId}" nicht gefunden`,
      duration: 0,
      cached: false,
    };
  }

  // Guard check
  const guard = createGuard(ctx.origin);
  if (!guard.canExecute(definition, ctx.origin)) {
    return {
      callId: '',
      toolId: resolvedId,
      success: false,
      error: guard.reason || 'Ausführung nicht erlaubt',
      duration: 0,
      cached: false,
    };
  }

  // Coerce and validate args
  const args = coerceToolArguments(rawArgs);
  const validation = validateToolArgs(definition, args);
  if (!validation.valid) {
    return {
      callId: '',
      toolId: resolvedId,
      success: false,
      error: `Validierung fehlgeschlagen: ${validation.error}`,
      duration: 0,
      cached: false,
    };
  }

  // Dedup check
  const dedupKey = makeDedupKey(resolvedId, validation.data || args);
  if (dedupCache.has(dedupKey)) {
    const cached = dedupCache.get(dedupKey)!;
    return { ...cached, cached: true };
  }

  // Execute with timeout
  const timeoutMs = definition.maxDuration || 30000;
  let result: ToolResult;
  try {
    result = await Promise.race([
      toolRegistry.execute(resolvedId, validation.data || args, ctx),
      new Promise<ToolResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout nach ${timeoutMs}ms`)), timeoutMs)
      ),
    ]) as ToolResult;
  } catch (err) {
    result = {
      callId: '',
      toolId: resolvedId,
      success: false,
      error: (err as Error).message,
      duration: timeoutMs,
      cached: false,
    };
  }

  // Compact result data for the model
  if (result.success && result.data) {
    result.data = compactToolData(result.data);
  }

  // Cache for dedup
  dedupCache.set(dedupKey, result);
  return result;
}
