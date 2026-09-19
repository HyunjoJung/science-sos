import { NextRequest } from "next/server";
import { configured, db } from "@/lib/supabase";
import { z } from "zod";
import { items } from "@/lib/content";
import { reasonSchema } from "@/lib/analysis";
import {
  ApiError, assertSameOrigin, authError, errorReply, jsonReply, readJsonObject, rpcError,
} from "@/lib/server/api-http";

function failure(error: unknown, requestId: string) {
  return errorReply(error instanceof z.ZodError ? new ApiError("INVALID_INPUT") : error, requestId);
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    if (!configured()) throw new ApiError("NOT_CONFIGURED");
    const s = await db();
    const { data: { user }, error: authFailure } = await s.auth.getUser();
    if (authFailure) {
      const error = authError(authFailure);
      if (error.code !== "UNAUTHORIZED") throw error;
      return jsonReply({ member: null, records: [] }, requestId);
    }
    if (!user) return jsonReply({ member: null, records: [] }, requestId);
    const id = req.nextUrl.searchParams.get("experiment");
    if (id !== null) z.uuid().parse(id);
    const { data, error } = await (id
      ? s.rpc("lab_experiment", { p_id: id })
      : s.rpc("lab_list"));
    if (error) throw rpcError(error);
    if (data === null) throw new ApiError("UNAVAILABLE");
    return jsonReply(data, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    if (!configured()) throw new ApiError("NOT_CONFIGURED");
    assertSameOrigin(req, process.env.APP_ORIGIN);
    const body = await readJsonObject(req, 16 * 1024);
    const s = await db();
    if (body.action === "login") {
      const value = z.object({ email: z.email(), password: z.string().min(1).max(200) }).parse(body.data);
      const { error } = await s.auth.signInWithPassword(value);
      if (error) {
        const mapped = authError(error);
        throw mapped.code === "UNAUTHORIZED" ? new ApiError("LOGIN_FAILED") : mapped;
      }
      return jsonReply({ ok: true }, requestId);
    }
    if (body.action === "logout") {
      const { error } = await s.auth.signOut();
      if (error) throw authError(error);
      return jsonReply({ ok: true }, requestId);
    }
    const { data: { user }, error: authFailure } = await s.auth.getUser();
    if (authFailure) throw authError(authFailure);
    if (!user) throw new ApiError("UNAUTHORIZED");
    const value = z.object({
      action: z.enum(["submit", "review", "reason", "observe", "revise", "reassess", "complete"]),
      id: z.uuid().nullable(),
      version: z.number().int().positive().nullable(),
      request: z.uuid(),
      data: z.record(z.string(), z.unknown()),
    }).parse(body);
    if (["submit", "reason", "reassess"].includes(value.action)) reasonSchema.parse(value.data.reason);
    if (value.action === "submit") {
      const item = items.find((item) => item.id === value.data.item && item.pair);
      if (!item || typeof value.data.prediction !== "string" || !item.choices.includes(value.data.prediction))
        throw new ApiError("INVALID_INPUT");
    }
    if (value.action === "revise") reasonSchema.parse(value.data.text);
    if (value.action === "reassess") {
      const { data: snapshot, error } = await s.rpc("lab_list");
      if (error) throw rpcError(error);
      if (!snapshot || !Array.isArray(snapshot.records)) throw new ApiError("UNAVAILABLE");
      const row = snapshot.records.find((record: { id: string }) => record.id === value.id);
      if (!row) throw new ApiError("NOT_FOUND");
      const original = items.find((item) => item.id === row.item_id);
      const item = items.find((item) => item.id === original?.pair);
      if (!item || typeof value.data.prediction !== "string" || !item.choices.includes(value.data.prediction))
        throw new ApiError("INVALID_INPUT");
    }
    const { data, error } = await s.rpc("lab_act", {
      p_action: value.action, p_id: value.id, p_version: value.version,
      p_data: value.data, p_request: value.request,
    });
    if (error) throw rpcError(error);
    if (typeof data !== "string") throw new ApiError("UNAVAILABLE");
    return jsonReply({ id: data }, requestId);
  } catch (error) { return failure(error, requestId); }
}
