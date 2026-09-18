import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { z } from "zod";
import answers from "@/lib/server/answers.json";
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const s = await db();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return reply({ error: "로그인해 주세요." }, 401);
  const { data, error } = await s.rpc("lab_space");
  if (error) return reply({ error: "수업 정보를 불러올 수 없어요." }, 403);
  const { data: m } = await s
    .from("lab_members")
    .select("role")
    .eq("user_id", user.id)
    .single();
  return reply({
    ...data,
    answers: m?.role === "teacher" ? answers : undefined,
  });
}
export async function POST(req: NextRequest) {
  try {
    if (
      req.headers.get("origin") !== req.nextUrl.origin &&
      req.headers.get("origin") !== process.env.APP_ORIGIN
    )
      return reply({ error: "허용되지 않은 요청이에요." }, 403);
    const s = await db();
    const {
      data: { user },
    } = await s.auth.getUser();
    if (!user) return reply({ error: "로그인해 주세요." }, 401);
    const v = z
      .object({
        action: z.enum([
          "material_add",
          "material_edit",
          "feedback_send",
          "feedback_read",
          "chat_send",
          "topic_add",
          "post_add",
          "like_toggle",
        ]),
        id: z.uuid().nullable(),
        request: z.uuid(),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(await req.json());
    const { data, error } = await s.rpc("lab_space_act", {
      p_action: v.action,
      p_id: v.id,
      p_data: v.data,
      p_request: v.request,
    });
    if (error)
      return reply(
        {
          error: error.message.includes("rate_limit")
            ? "잠시 후 다시 보내주세요."
            : "입력 내용과 수업 권한을 확인해 주세요.",
        },
        422,
      );
    return reply({ id: data });
  } catch {
    return reply({ error: "입력 내용을 확인해 주세요." }, 422);
  }
}
