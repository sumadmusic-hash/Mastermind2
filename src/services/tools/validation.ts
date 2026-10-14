import { z } from 'zod';
import type { ToolDefinition } from '../../types/tool';

export function validateToolArgs(definition: ToolDefinition, args: Record<string, unknown>): {
  valid: boolean;
  data?: Record<string, unknown>;
  error?: string;
} {
  try {
    const schema = definition.inputSchema;
    if (!schema || !schema.type) {
      return { valid: true, data: args };
    }
    // Build a Zod schema from JSON Schema (simplified)
    const zodSchema = jsonSchemaToZod(schema);
    const result = zodSchema.safeParse(args);
    if (result.success) {
      return { valid: true, data: result.data as Record<string, unknown> };
    }
    return { valid: false, error: result.error.message };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required || []) as string[];
  const shape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let fieldSchema: z.ZodType;
    switch (prop.type) {
      case 'string':
        fieldSchema = z.string();
        if (prop.description) fieldSchema = fieldSchema.describe(prop.description as string);
        break;
      case 'number':
      case 'integer':
        fieldSchema = z.number();
        break;
      case 'boolean':
        fieldSchema = z.boolean();
        break;
      case 'array':
        fieldSchema = z.array(z.any());
        break;
      case 'object':
        fieldSchema = z.record(z.any());
        break;
      default:
        fieldSchema = z.any();
    }
    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }
    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

export function coerceToolArguments(args: unknown): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
  if (typeof args === 'object' && args !== null) {
    return args as Record<string, unknown>;
  }
  return {};
}
