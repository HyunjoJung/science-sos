import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "과학SOS · 반례실험실",
  description:
    "틀린 답에서 시작하는 새로운 발견. 예측하고, 관찰하고, 다시 설명하는 과학 탐구.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
