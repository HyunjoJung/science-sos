import { NextRequest } from "next/server";
import { configured, db } from "@/lib/supabase";
import { z } from "zod";
import answers from "@/lib/server/answers.json";
import {
  ApiError, assertSameOrigin, authError, errorReply, jsonReply, readJsonObject, rpcError,
} from "@/lib/server/api-http";

function failure(error: unknown, requestId: string) {
  return errorReply(error instanceof z.ZodError ? new ApiError("INVALID_INPUT") : error, requestId);
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    if (!configured()) throw new ApiError("NOT_CONFIGURED");
    const s = await db();
    const { data: { user }, error: authFailure } = await s.auth.getUser();
    if (authFailure) throw authError(authFailure);
    if (!user) throw new ApiError("UNAUTHORIZED");
    const { data, error } = await s.rpc("lab_space");
    if (error) throw rpcError(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError("UNAVAILABLE");
    const { data: member, error: memberError } = await s.from("lab_members")
      .select("role").eq("user_id", user.id).single();
    if (memberError) throw rpcError(memberError);
    if (!member || !["teacher", "student"].includes(member.role)) throw new ApiError("FORBIDDEN");
    return jsonReply({ ...data, answers: member.role === "teacher" ? answers : undefined }, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    if (!configured()) throw new ApiError("NOT_CONFIGURED");
    assertSameOrigin(req, process.env.APP_ORIGIN);
    const body = await readJsonObject(req, 256 * 1024);
    const s = await db();
    const { data: { user }, error: authFailure } = await s.auth.getUser();
    if (authFailure) throw authError(authFailure);
    if (!user) throw new ApiError("UNAUTHORIZED");
    const value = z.object({
      action: z.enum(["material_add", "material_edit", "feedback_send", "feedback_read", "chat_send", "topic_add", "post_add", "like_toggle"]),
      id: z.uuid().nullable(), request: z.uuid(), data: z.record(z.string(), z.unknown()),
    }).parse(body);
    const { data, error } = await s.rpc("lab_space_act", {
      p_action: value.action, p_id: value.id, p_data: value.data, p_request: value.request,
    });
    if (error) throw rpcError(error);
    if (typeof data !== "string") throw new ApiError("UNAVAILABLE");
    return jsonReply({ id: data }, requestId);
  } catch (error) { return failure(error, requestId); }
}
