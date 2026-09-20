import Link from "next/link";

export default function ClassroomEntryNav({ demo = false }: { demo?: boolean }) {
  return (
    <nav className="classroom-entry-nav" aria-label="교실 이동">
      <span>{demo ? "과학SOS 체험 교실" : "과학SOS 수업 공간"}</span>
      <div>
        {demo ? (
          <Link href="/">실제 수업 로그인 →</Link>
        ) : (
          <>
            <Link href="/demo">로그인 없이 둘러보기</Link>
            <Link href="/learn">다과목 학습 교실 →</Link>
          </>
        )}
      </div>
    </nav>
  );
}
