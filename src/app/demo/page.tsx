import Workspace from "@/components/Workspace";
export const metadata = {
  title: "발표용 예시 교실 · 과학SOS",
  robots: { index: false, follow: false },
};
export default function DemoPage() {
  return <Workspace configured={false} demo />;
}
