import type { Metadata } from "next";
import LiveTrial from "@/components/LiveTrial";
import "./trial.css";

export const metadata: Metadata = {
  title: "직접 AI 체험 · 과학SOS",
  description: "내가 쓴 이유를 실제 AI로 분석하고, 교사 역할로 반례를 선택한 뒤 설명의 변화를 경험해 보세요.",
  robots: { index: false, follow: false },
};

export default function TrialPage() {
  return <LiveTrial />;
}
