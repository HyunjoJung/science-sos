# 과학SOS · 반례실험실

**학생이 답을 고른 이유를 읽고, 교사가 고른 확인 활동을 거쳐 설명을 다시 쓰게 하는 학습지원 도구입니다.**

AI for Good 서울 정책 토론 및 해커톤에서 시작한 과학 교실을 과학·수학 두 과목의 공통 학습 흐름으로 확장하고 있습니다. 저장소 이름은 `science-sos`이며 새 `/learn` 화면은 `학습SOS`라는 이름을 사용합니다.

## 먼저 볼 곳

| 경로 | 제공 내용 | 배포와 데이터 상태 |
| --- | --- | --- |
| [과학 교실](https://science-sos.vercel.app/) `/` | 학생·교사 로그인, 사고 기록, 교사 검토, 반례 활동, 자료실·피드백·채팅·토론 | 기존 main 배포. Supabase에 저장하며 AI 분석·자료 답변에는 별도의 Cursor PC 워커 실행이 필요합니다. |
| [체험 화면](https://science-sos.vercel.app/demo) `/demo` | 가상 학생 24명과 8개 수업을 활용한 화면 체험 | 기존 main 배포. 브라우저에 저장하는 가상 학급이며 분석과 답변은 사전 작성된 자료입니다. |
| `/try` | 직접 쓴 이유의 실제 AI 분석, 교사 역할 확인, 반례 관찰·설명 수정 | 기능 브랜치. 체험 전용 DB·서버 환경변수·별도 Cursor 워커 연결이 필요합니다. [연결과 한도](docs/LIVE_TRIAL.md) |
| `/learn` | 과학·수학 콘텐츠 팩, 교사 배정, 영속 작업 큐, 독립 분석 워커, 활동·전이 문항·피드백 | 기능 브랜치에 구현. 운영 DB 적용·모델 연결·상시 워커 배포가 필요한 경로입니다. |
| `/integrations`, `/api/mcp` | 공개 학습자료 MCP 연결 안내와 읽기 전용 링크 디렉터리 | 기능 브랜치에 구현. 공개 MCP는 기본 OFF이며, 교사가 승인한 자료만 학생 기록에 전달합니다. |

2026-09-20 문서 갱신 기준 main은 `a31aa5b`이며 확장 기능은 `feature/learning-mcp-resources`에서 개발합니다. `/try`의 체험 전용 DB와 실제 Cursor 호출은 로컬 브라우저에서 연결했으며, 외부 프리뷰의 서버 비밀키 설정은 별도 승인 대기 중입니다. 이전 DB 기록과 체험 데이터를 삭제하거나 새 구조로 소급 채점하지 않습니다.

## 핵심 경험

1. 교사가 콘텐츠 팩의 범위·문항·정답·루브릭·활동을 검토하고 학급에 배정합니다.
2. 학생이 답과 이유를 남깁니다. 새 학습 경로에서는 답안과 분석 작업을 함께 DB에 저장합니다.
3. AI가 이유에 대한 가설과 원문 근거를 제안합니다. 교사는 보완 질문, 확인 활동, 이해 확인 중 다음 단계를 결정합니다.
4. 학생은 승인된 활동을 수행하고 설명을 수정한 뒤 새 조건의 문항에 답합니다.
5. 교사는 처음 이유·관찰·수정·전이 응답을 함께 보고 최종 피드백을 남깁니다.

새 팩은 **과학의 질량·밀도 비교**와 **수학의 단위분수 막대 비교**입니다. 서비스에서 작성한 예시 팩으로, 교육과정 인증이나 실제 학생 대상 학습 효과를 주장하지 않습니다. 기존 과학 교실의 8개 수업과 새 엔진의 두 팩은 별개입니다.

## AI와 자료 연결

- 기존 `/`: 공식 Cursor CLI를 실행하는 PC 워커가 이유 분석과 수업 자료 근거 답변을 처리합니다. PC가 꺼지면 새로운 AI 작업이 진행되지 않습니다.
- 새 `/learn`: 독립 서버 워커와 Vercel AI Gateway 어댑터를 구현했습니다. 작업 임대·재시도·호출 한도를 DB에서 관리하며, Vercel 웹 배포만으로 워커가 실행되는 것은 아닙니다. 실제 공급자 권한·모델 응답·비용은 별도 확인 대상입니다.
- MCP: 공식 링크 4개를 담은 작은 디렉터리입니다. 학생 원문을 MCP로 보내지 않고 과목·주제 코드로 후보를 찾습니다. EBSMath·Khan Academy·PhET의 공식 MCP나 실시간 본문 검색이 아닙니다. 교사의 검토·전달 이후에만 학생에게 표시됩니다.
- AI 제안은 확정 진단이나 성적이 아닙니다. 근거가 부족하거나 분석이 실패하면 교사가 원문을 직접 검토할 수 있으며, 실패를 사전 작성 AI 답변으로 바꾸지 않습니다.

## 로컬 실행

Node.js 22와 pnpm 10.33.2가 필요합니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

먼저 `http://localhost:3000/demo`에서 인증 없이 기존 체험 화면을 볼 수 있습니다. 실제 로그인 경로는 `.env.example`을 참고해 비공개 `.env.local`에 웹용 Supabase 설정과 정확한 `APP_ORIGIN`을 지정해야 합니다. 비밀키·계정 비밀번호를 Git이나 브라우저에 넣지 않습니다.

기존 과학 교실의 Cursor 워커는 공식 CLI 로그인과 로컬 환경 설정을 마친 뒤 별도 터미널에서 실행합니다.

```sh
pnpm worker
```

새 `/learn`을 연결할 때는 [학습 경로 설정](docs/LEARNING_CONNECTED.md), [Gateway 설정](docs/VERCEL_AI_GATEWAY.md), [MCP 설정](docs/MCP_RESOURCES.md)의 순서를 따릅니다. 격리 환경에서 기존 DB 이력을 확인하고 마이그레이션 005~007을 순차 적용한 뒤 `.env.learning.example`을 참고해 웹 설정과 비공개 `.env.worker`를 나눠 구성합니다. 수동 적용된 001~004를 다시 실행하지 않습니다.

```sh
# 필요한 마이그레이션과 비공개 워커 환경 구성이 끝난 뒤 실행
node --env-file=.env.worker scripts/learning-seed.mjs
docker compose -f deploy/compose.learning.yml up --build -d
```

팩 등록 후에도 교사의 검토·배정이 필요합니다. 새 경로는 기존 Cursor 워커나 채팅을 자동 교체하지 않습니다.

## 확인 명령

외부 서비스 자격증명이나 운영 DB 쓰기 없이 실행하는 기본 확인입니다.

```sh
pnpm test
pnpm exec tsc -p tsconfig.foundation.json
pnpm typecheck
pnpm test:demo
pnpm build
```

`pnpm test`는 순수 로직과 MCP 계약 테스트를 실행합니다. MCP만 확인하려면 `pnpm test:mcp`를 사용합니다. 이 명령들은 라이브 모델 호출 성공을 입증하지 않습니다.

[Connected learning CI](.github/workflows/learning.yml)는 일회용 PostgreSQL, 합성 인증·모델 응답과 Chromium으로 두 과목의 HTTP·DB·워커·MCP·교사 승인 흐름을 검사합니다. 실행 진입점은 `bash scripts/integration/verify-learning.sh`이며 CI에 정의된 별도 DB와 브라우저 준비가 필요합니다. 합성 모델을 사용하는 시험과 운영 Supabase 인증·라이브 Gateway 점검은 구분합니다.

다음 명령은 기존 과학 교실의 **실제 DB 기록과 Cursor 요청을 생성**하므로 운영 점검용 계정·환경을 확인한 뒤 실행합니다.

```sh
pnpm test:integration
pnpm test:classroom
```

## 문서

- [원티드 제출 초안·현재 준비 상태](docs/WANTED_SUBMISSION.md)
- [로그인 없는 실제 AI 체험](docs/LIVE_TRIAL.md)
- [학습 경로와 독립 워커 연결](docs/LEARNING_CONNECTED.md)
- [Vercel AI Gateway 설정·비용·오류 처리](docs/VERCEL_AI_GATEWAY.md)
- [공개 MCP 자료 연결·교사 승인](docs/MCP_RESOURCES.md)
- [프로덕션 준비 설계와 남은 출시 조건](docs/PRODUCTION_READINESS.md)
- [기존 과학 교실 운영 안내](docs/OPERATIONS.md) — Cursor 워커 실행과 현재 운영 점검 기록
- [60초·3분 발표 안내](docs/PRESENTATION.md)
- [PRD · 초기 제품 요구사항](docs/PRD.md)
- [TRD · 초기 Supabase + Vercel 기술 설계](docs/TRD.md)
- [MVP 명세](docs/mvp.md), [정책·공공지원 제안](docs/policy-proposal.md), [작업 목록](docs/backlog.md)

초기 PRD/TRD에는 당시 계획이 포함되어 있습니다. 새 학습 경로의 구현 범위는 연결 문서를, 실제 출시 여부는 배포·운영 확인 결과를 기준으로 판단합니다. 교육청 집계, 학교 계정 관리, 보존·삭제 운영, 실제 수업 효과 평가는 후속 범위입니다.

## 기획 출처

사용자 제공 「과학SOS_반례실험실_제안서_A4세로.pdf」를 바탕으로 시작했습니다. 원본 PDF는 저장소에 포함하지 않았으며 문서 내 참고문헌을 모두 검증했다는 의미는 아닙니다.
