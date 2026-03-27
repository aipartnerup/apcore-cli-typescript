/**
 * Display overlay helpers — shared resolution logic for CLI surfaces.
 */

import type { ModuleDescriptor } from "./cli.js";

/**
 * Extract resolved display overlay from a ModuleDescriptor's metadata.
 */
export function getDisplay(descriptor: ModuleDescriptor): Record<string, unknown> {
  const metadata = descriptor.metadata ?? {};
  const display = (metadata as Record<string, unknown>).display;
  if (display && typeof display === "object" && !Array.isArray(display)) {
    return display as Record<string, unknown>;
  }
  return {};
}

/**
 * Return [displayName, description, tags] resolved from the display overlay.
 *
 * Falls back to scanner-provided values when no overlay is present.
 */
export function getCliDisplayFields(descriptor: ModuleDescriptor): [string, string, string[]] {
  const display = getDisplay(descriptor);
  const cli = (display.cli && typeof display.cli === "object" && !Array.isArray(display.cli))
    ? (display.cli as Record<string, unknown>)
    : {};
  const name = (cli.alias as string | undefined)
    ?? (display.alias as string | undefined)
    ?? descriptor.id;
  const desc = (cli.description as string | undefined) ?? descriptor.description;
  const tags = (display.tags as string[] | undefined) ?? descriptor.tags ?? [];
  return [name, desc, tags];
}
