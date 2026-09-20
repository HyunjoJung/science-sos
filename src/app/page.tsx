import { configured } from "@/lib/supabase";
import Lab from "@/components/Workspace";
import ClassroomEntryNav from "@/components/ClassroomEntryNav";
export const dynamic = "force-dynamic";
export default function Page() {
  return <><ClassroomEntryNav /><Lab configured={configured()} /></>;
}
