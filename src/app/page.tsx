import { configured } from "@/lib/supabase";
import Lab from "@/components/Workspace";
export const dynamic = "force-dynamic";
export default function Page() {
  return <><nav aria-label="학습SOS 연결" style={{padding:"12px 24px"}}><a href="/learn">다과목 학습 교실 열기 →</a></nav><Lab configured={configured()} /></>;
}
