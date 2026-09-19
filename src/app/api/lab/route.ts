import { NextRequest, NextResponse } from "next/server";
import { configured, db } from "@/lib/supabase";
import { z } from "zod";
import { items } from "@/lib/content";
import { labCommand, uuid } from "@/lib/runtime/commands.mjs";
import { AppError, object, publicFailure, readJson, requireOrigin, rpcError } from "@/lib/runtime/http.mjs";

const response = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
function failure(error: unknown, requestId: string) {
  const result = publicFailure(error, requestId);
  if (result.status >= 500) console.error("lab_request_failed", { requestId, code: result.body.code });
  return response(result.body, result.status, { ...result.headers, "X-Request-Id": requestId });
}
function ready() {
  if (!configured()) throw new AppError("not_configured", 503, "데이터베이스 연결이 준비되지 않았어요.");
}

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    ready();
    const s = await db();
    const { data: { user }, error: authError } = await s.auth.getUser();
    if (authError && authError.status && authError.status >= 500)
      throw new AppError("auth_unavailable", 503, "로그인 정보를 확인하지 못했어요.");
    if (!user) return response({ member: null, records: [] });
    const id = req.nextUrl.searchParams.get("experiment");
    if (id !== null) uuid(id);
    const { data, error } = await (id ? s.rpc("lab_experiment", { p_id: id }) : s.rpc("lab_list"));
    if (error) throw rpcError(error);
    if (data === null) throw new AppError("invalid_response", 502, "기록을 불러오지 못했어요.");
    return response(data);
  } catch (error) { return failure(error, requestId); }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    ready();
    requireOrigin(req, req.nextUrl.origin, process.env.APP_ORIGIN);
    const body = object(await readJson(req));
    const s = await db();
    if (body.action === "login") {
      const parsed = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).safeParse(body.data);
      if (!parsed.success) throw new AppError("invalid_input", 422, "이메일과 비밀번호 형식을 확인해 주세요.");
      const { error } = await s.auth.signInWithPassword(parsed.data);
      if (error) {
        if (error.status === 429) throw new AppError("rate_limit", 429, "로그인 요청이 많아요. 잠시 후 다시 시도해 주세요.");
        if (error.status && error.status >= 500) throw new AppError("auth_unavailable", 503, "로그인 서버에 연결하지 못했어요.");
        throw new AppError("invalid_credentials", 401, "이메일 또는 비밀번호를 확인해 주세요.");
      }
      return response({ ok: true });
    }
    if (body.action === "logout") {
      const { error } = await s.auth.signOut();
      if (error) throw new AppError("logout_unconfirmed", 503, "로그아웃을 확인하지 못했어요. 다시 시도해 주세요.");
      return response({ ok: true });
    }
    const { data: { user }, error: authError } = await s.auth.getUser();
    if (authError && authError.status && authError.status >= 500)
      throw new AppError("auth_unavailable", 503, "로그인 정보를 확인하지 못했어요.");
    if (!user) throw new AppError("unauthorized", 401, "로그인해 주세요.");
    if (req.headers.has("x-science-actor") && req.headers.get("x-science-actor") !== user.id)
      throw new AppError("session_changed", 401, "계정이 변경됐어요. 새로고침 후 다시 확인해 주세요.");
    const v = labCommand(body);
    if (v.action === "submit") {
      const item = items.find((i) => i.id === v.data.item && i.pair);
      if (!item || !item.choices.includes(String(v.data.prediction)))
        throw new AppError("invalid_choice", 422, "이 문항의 선택지를 확인해 주세요.");
    }
    if (v.action === "reassess") {
      const { data, error } = await s.rpc("lab_list");
      if (error) throw rpcError(error);
      if (!data || !Array.isArray(data.records))
        throw new AppError("invalid_response", 502, "재확인할 기록을 불러오지 못했어요.");
      const row = data.records.find((r: { id: string }) => r.id === v.id);
      if (!row) throw new AppError("not_found", 404, "재확인할 기록을 찾을 수 없어요.");
      const original = items.find((i) => i.id === row.item_id);
      const item = items.find((i) => i.id === original?.pair);
      if (!item?.choices.includes(String(v.data.prediction)))
        throw new AppError("invalid_choice", 422, "재확인 문항의 선택지를 확인해 주세요.");
    }
    const { data, error } = await s.rpc("lab_act", {
      p_action: v.action, p_id: v.id, p_version: v.version, p_data: v.data, p_request: v.request,
    });
    if (error) throw rpcError(error);
    if (typeof data !== "string") throw new AppError("save_unconfirmed", 502, "저장 결과를 확인하지 못했어요.");
    return response({ id: data });
  } catch (error) { return failure(error, requestId); }
}
