import { NextRequest, NextResponse } from "next/server";
import { configured, db } from "@/lib/supabase";
import { z } from "zod";
import { items } from "@/lib/content";
import { reasonSchema } from "@/lib/analysis";
const response = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(req: NextRequest) {
  if (!configured())
    return response(
      { error: "아직 데이터베이스 연결이 준비되지 않았어요." },
      503,
    );
  const s = await db();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return response({ member: null, records: [] });
  const id = req.nextUrl.searchParams.get("experiment");
  const { data, error } = await (id
    ? s.rpc("lab_experiment", { p_id: id })
    : s.rpc("lab_list"));
  if (error) return response({ error: "이 기록에 접근할 권한이 없어요." }, 403);
  return response(data);
}
export async function POST(req: NextRequest) {
  try {
    if (!configured())
      return response({ error: "데이터베이스 연결이 필요해요." }, 503);
    if (
      req.headers.get("origin") !== req.nextUrl.origin &&
      req.headers.get("origin") !== process.env.APP_ORIGIN
    )
      return response({ error: "허용되지 않은 요청이에요." }, 403);
    const body = await req.json();
    const s = await db();
    if (body.action === "login") {
      const v = z
        .object({ email: z.email(), password: z.string().min(1).max(200) })
        .parse(body.data);
      const { error } = await s.auth.signInWithPassword(v);
      return error
        ? response({ error: "이메일 또는 비밀번호를 확인해 주세요." }, 401)
        : response({ ok: true });
    }
    if (body.action === "logout") {
      await s.auth.signOut();
      return response({ ok: true });
    }
    const {
      data: { user },
    } = await s.auth.getUser();
    if (!user) return response({ error: "로그인해 주세요." }, 401);
    const v = z
      .object({
        action: z.enum([
          "submit",
          "review",
          "reason",
          "observe",
          "revise",
          "reassess",
          "complete",
        ]),
        id: z.uuid().nullable(),
        version: z.number().int().positive().nullable(),
        request: z.uuid(),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(body);
    if (
      v.action === "submit" ||
      v.action === "reason" ||
      v.action === "reassess"
    )
      reasonSchema.parse(v.data.reason);
    if (v.action === "submit") {
      const item = items.find((i) => i.id === v.data.item && i.pair);
      if (!item || !item.choices.includes(String(v.data.prediction)))
        throw Error("invalid");
    }
    if (v.action === "revise") reasonSchema.parse(v.data.text);
    if (v.action === "reassess") {
      const { data } = await s.rpc("lab_list");
      const row = data.records.find((r: { id: string }) => r.id === v.id);
      const original = items.find((i) => i.id === row?.item_id);
      const item = items.find((i) => i.id === original?.pair);
      if (!item?.choices.includes(String(v.data.prediction)))
        throw Error("invalid");
    }
    const { data, error } = await s.rpc("lab_act", {
      p_action: v.action,
      p_id: v.id,
      p_version: v.version,
      p_data: v.data,
      p_request: v.request,
    });
    if (error) {
      const conflict = error.message.includes("conflict");
      return response(
        {
          error: conflict
            ? "다른 화면에서 기록이 바뀌었어요. 새로고침 후 다시 확인해 주세요."
            : "현재 단계에서 처리할 수 없어요. 입력과 권한을 확인해 주세요.",
        },
        conflict ? 409 : 422,
      );
    }
    return response({ id: data });
  } catch {
    return response(
      { error: "입력값을 확인해 주세요. 설명은 1~300자로 작성할 수 있어요." },
      422,
    );
  }
}
