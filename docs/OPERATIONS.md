# 구현 및 운영 안내

2026-09-18. 실제 구현 상태는 이 문서가 초기 PRD/TRD의 계획보다 우선합니다.

## 연결

- Supabase: `science-sos-demo`, 프로젝트 `qajtzsoddpqmmdwjcayy`, Tokyo `ap-northeast-1`, Free. 사용자가 승인한 HyunjoJung 계정의 조직 사용.
- Vercel: HyunjoJung's projects 팀, GitHub `HyunjoJung/science-sos` 연결 대상.
- Cursor: `j96263732@gmail.com` 공식 CLI 로그인 및 실제 추론 성공. 대시보드 $100 크레딧 잔액 확인. 개별 호출의 청구·크레딧 차감 금액은 검증하지 않았음.
- 학생/교사 계정은 Supabase Auth에 실제 생성. 비밀번호는 Git에서 제외한 `.secrets/accounts.json`에만 저장. 실명 학생 자료를 넣지 않은 해커톤 계정.

## 구조

브라우저 → Next.js `/api/lab` → 사용자 세션으로 Supabase RPC 호출.
학생 제출 → DB `pending` → 이 PC의 Cursor 워커 → 실제 JSON 분석 → 교사 검토 → 승인된 고정 과학 실험 → 학생 설명 수정 → 새 문항 → 교사 루브릭.

Vercel에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, 배포 주소인 `APP_ORIGIN`만 설정합니다. 서비스 키와 Cursor 로그인 자격증명은 배포하지 않습니다.

로컬 워커에 필요한 값은 `.env.example` 참조. CLI 경로는 공식 Cursor 배포본의 `index.js`, Node 경로는 해당 배포본의 `node.exe`입니다. `CURSOR_WORKSPACE`는 앱·키·학생 파일이 없는 별도 디렉터리입니다. 워커는 도구 사용을 금지하고 자식 프로세스 환경에서 Supabase 키를 제거합니다. 구조화 응답과 원문 근거를 검증합니다.

```powershell
node --env-file=.env.local scripts/cursor-worker.mjs
```

PC가 꺼지거나 워커가 종료되면 새 답안의 AI 분석은 대기합니다. 교사는 원문을 읽고 직접 검토할 수 있습니다. 호출 오류는 '분석 불가 · 직접 검토'로 표시하며 고정 답변으로 대체하지 않습니다. 향후 상시 운영은 별도 모델 API 키를 이용하는 서버 워커로 교체해야 합니다. Vercel AI Gateway는 카드 등록을 요구해 이번에 활성화하지 않았습니다.

## 데이터와 권한

- `lab_members`: 역할과 반. 일반 가입만으로 역할을 얻을 수 없음.
- `lab_records`: 현재 사고 기록. 직접 읽기/쓰기 차단, 세션을 확인하는 RPC만 허용.
- private 스키마: 이전 기록, 요청 중복 방지, AI 임대와 일별 요청 예산.
- 학생은 자기 기록, 교사는 자기 반만 조회. 학생 응답에서 AI 가설과 근거 노트 제외.
- 승인 전 실험 결과 조회 거부. 모든 수정은 버전 검증. 일별 AI 요청 최대 100회.
- SQL은 `supabase/migrations` 순서대로 적용. 현재 Supabase SQL Editor로 적용했으며 CLI migration history는 별도 등록하지 않았음.

## 검증

통합 검증 스크립트는 다른 학생/반 접근, 교사 권한, 승인 전 실험, 중복 요청, 오래된 버전, 누락 버전, 루브릭 null 거부, 실제 Cursor 분석, 보류·재제출·수정·재평가·완료를 검사합니다. 브라우저에서 로그인과 실제 저장된 기록을 확인합니다.

고정 과학 실험은 이상화한 시뮬레이션입니다. 실제 센서 관측이나 학생 실험 결과로 주장하지 않습니다. 통합 검증에서 만든 기록은 테스트 계정의 실행 기록이며 실제 수업 효과의 증거가 아닙니다.

## 초기 계획 대비 후속 범위

현재 custom CSS 사용. 교육청 집계·내보내기, 학교 운영용 계정 관리·동의·삭제 흐름, 장기 운영 모니터링, 별도 모델 API, 대규모 수업 실증은 아직 구현하지 않았습니다. 초기 TRD의 다중 테이블/API 구조를 작은 RPC 기반 구현으로 단순화했습니다.
