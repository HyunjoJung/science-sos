import Workspace from "@/components/Workspace";
import ClassroomEntryNav from "@/components/ClassroomEntryNav";
export const metadata = {
  title: "체험 교실 · 과학SOS",
  description: "학생의 이유, 교사의 반례 선택, 관찰과 설명 변화를 가상 학급에서 살펴보세요. 체험 분석과 답변은 사전 작성 자료입니다.",
  robots: { index: false, follow: false },
};
export default function DemoPage() {
  return <><ClassroomEntryNav demo /><Workspace configured={false} demo /></>;
}
