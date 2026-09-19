import { NextRequest, NextResponse } from "next/server";
import { configured, db } from "@/lib/supabase";
import answers from "@/lib/server/answers.json";
import { spaceCommand } from "@/lib/runtime/commands.mjs";
import { AppError, publicFailure, readJson, requireOrigin, rpcError } from "@/lib/runtime/http.mjs";

const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
function failure(error: unknown, requestId: string) {
  const result = publicFailure(error, requestId);
  if (result.status >= 500) console.error("space_request_failed", { requestId, code: result.body.code });
  return reply(result.body, result.status, { ...result.headers, "X-Request-Id": requestId });
}
async function session() {
  if (!configured()) throw new AppError("not_configured", 503, "수업 저장소 연결이 준비되지 않았어요.");
  const s = await db();
  const { data: { user }, error } = await s.auth.getUser();
  if (error && error.status && error.status >= 500)
    throw new AppError("auth_unavailable", 503, "로그인 정보를 확인하지 못했어요.");
  if (!user) throw new AppError("unauthorized", 401, "로그인해 주세요.");
  return { s, user };
}

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { s, user } = await session();
    const { data, error } = await s.rpc("lab_space");
    if (error) throw rpcError(error);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new AppError("invalid_response", 502, "수업 정보를 불러오지 못했어요.");
    const { data: member, error: memberError } = await s.from("lab_members").select("role").eq("user_id", user.id).single();
    if (memberError) throw rpcError(memberError);
    if (!member) throw new AppError("forbidden", 403, "수업에 등록된 계정으로 로그인해 주세요.");
    return reply({ ...data, member_id: user.id, answers: member.role === "teacher" ? answers : undefined });
  } catch (error) { return failure(error, requestId); }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    requireOrigin(req, req.nextUrl.origin, process.env.APP_ORIGIN);
    const { s } = await session();
    const v = spaceCommand(await readJson(req));
    const { data, error } = await s.rpc("lab_space_act", {
      p_action: v.action, p_id: v.id, p_data: v.data, p_request: v.request,
    });
    if (error) throw rpcError(error);
    if (typeof data !== "string") throw new AppError("save_unconfirmed", 502, "저장 결과를 확인하지 못했어요.");
    return reply({ id: data });
  } catch (error) { return failure(error, requestId); }
}
