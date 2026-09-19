// Compile-only contracts between the dependency-free modules and the Next.js adapters.
import { publicFailure } from "../src/lib/runtime/http.mjs";
import { createMutationClient } from "../src/lib/runtime/client.mjs";
import { labCommand } from "../src/lib/runtime/commands.mjs";

export function verifyPublicHeaders(error: unknown): Record<string, string> {
  return { ...publicFailure(error, "trace-id").headers, "X-Request-Id": "trace-id" };
}
export async function verifyMutationReturn() {
  const client = createMutationClient();
  const result: { id?: string; ok?: boolean } = await client.send("user", "/api/lab", "submit", {});
  return result;
}
export function verifyCommand(raw: unknown) {
  const command = labCommand(raw);
  const id: string | null = command.id;
  const version: number | null = command.version;
  const request: string = command.request;
  return { id, version, request };
}
