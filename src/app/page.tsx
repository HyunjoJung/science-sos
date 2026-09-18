import { configured } from "@/lib/supabase";
import Lab from "@/components/Lab";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Lab configured={configured()} />;
}
