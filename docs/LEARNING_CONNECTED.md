# 학습SOS 연결 구현

이 변경은 `/learn` 화면, `/api/learning`, 실제 PostgreSQL RPC, 영속 작업 큐, 서버 모델 어댑터를 연결한다. 기존 과학 교실과 기존 데이터는 그대로 둔다. 루트 화면에서 새 교실로 이동할 수 있다. 전체 프로덕션 출시 승인과 이 코드의 구현/시험 완료는 다르다.

## 연결된 사용자 흐름

기존 Supabase 학생·교사 계정으로 로그인 → 교실 선택 → 교사가 과목 팩의 범위·정답·루브릭·활동·전이문항을 검토하고 배정 → 학생 제출 → DB 저장과 작업 등록 → 서버 워커 분석 → 교사 보완 질문/활동 배정/이해 확인 → 학생 활동 및 전이문항 → 교사 최종 피드백.

과학(질량·밀도 비교)과 수학(단위분수 막대 비교) 팩을 제공한다. 두 팩은 서비스 작성 예시이고 **공식 교육과정 검증이나 학생 대상 효능 검증을 받았다는 뜻이 아니다.** 교사 검토 확인 없이는 배정되지 않는다. 같은 버전의 콘텐츠는 수정할 수 없다.

기존 `nextProposal` 커널을 실제 워커가 호출한다. `learning_act`는 세션 기반 권한·버전·활동·선택지·재전송 검사를 DB에서 반복한다. DB 상태 전이와 순수 함수 `transition`의 일치 여부를 통합시험으로 확인한다. 신규 화면은 요청 UUID 유지 및 조회 세대 보호 공통 모듈을 사용한다. 이전의 다운로드 패치 전체를 설치해야 하는 의존성은 없다.

## 적용 순서 (먼저 격리 staging)

1. 기존 DB와 저장소 001~004의 정합성을 확인하고 백업한다. 기존 환경은 수동 적용 이력이 있으므로 migration history가 비었다고 001~004를 재실행하지 않는다.
2. `005_learning_connected.sql`을 **한 트랜잭션으로** 적용한다. 기존 `lab_members`에서 교실과 등록 관계를 한 번 초기화한다. 이것은 운영 DB에 자동 적용되는 배포가 아니다.
3. `.env.learning.example`을 참고해 웹에는 기존 Supabase URL·publishable key·정확한 APP_ORIGIN만, 워커에는 별도 secret key·모델 endpoint/key/model을 지정한다. 시크릿을 Git/채팅/브라우저에 넣지 않는다.
4. `node --env-file=.env.worker scripts/learning-seed.mjs`로 작성 예시 팩을 등록한다. 동일 데이터 재실행은 안전하고, 같은 버전의 다른 정의는 거부한다.
5. `docker compose -f deploy/compose.learning.yml up --build -d`로 워커를 운영한다. 웹 요청 시간 안에 모델 추론을 실행하지 않는다. 웹만 배포해서는 AI 작업이 처리되지 않는다.
6. 새 웹 배포의 `/learn`에서 담당 교사가 자료를 검토·배정한다. 학생은 배정된 자료만 제출할 수 있다.

Supabase secret key는 새로운 `sb_secret_` 키면 apikey 헤더에만, 레거시 JWT 키면 apikey 및 Bearer 헤더로 보낸다. 워커는 정해진 RPC allowlist만 호출한다. DB 함수 실행권한이 실제 보안 경계이고, 로컬 allowlist가 유출된 서비스 키의 권한을 제한하는 것은 아니다.

모델은 HTTPS Chat Completions 형식의 JSON mode 및 max_completion_tokens를 지원해야 한다. 해당 요청을 지원하지 않는 서버는 400 오류가 나므로 모델 서버 계약을 먼저 확인한다. 기본 모델/제공자를 임의 지정하거나 키를 자동 생성하지 않는다. 지원하지 않는 제공자에 자동 전환하지 않는다.

## 복구·권한 동작

- 최초 답안과 AI 작업은 한 트랜잭션에 저장된다. 요청이 반복되어도 같은 사용자·UUID·payload는 같은 결과 ID를 반환한다. payload 변경은 충돌이다.
- 답안의 교실/과제/팩 버전은 생성 당시에 고정된다. `learning_enrolments.active`로 접근을 회수한다. 신규 교사·학생 자동 가입/역할 부여 UI는 제공하지 않으며, 별도의 관리 절차가 필요하다.
- 학생은 자기 답안만, 교사는 등록된 교실만 조회한다. 학생에게 AI 제안·루브릭·정답 목록을 반환하지 않는다. 활동·전이문항은 승인 단계에서만 제공한다.
- 큐 선점은 `FOR UPDATE SKIP LOCKED`. 레코드→작업 순으로 잠가 교사 작업과 잠금 순서를 맞춘다. 모델 45초, DB 요청 15초, 작업 임대 90초다.
- 재시도와 워커 종료/재시작을 포함해 작업당 최대 3회 모델 호출. 만료된 임대는 재선점하고, 오래된 답안·임대의 완료는 거부한다.
- 작업 완료 응답이 유실되어도 오류 답변으로 성공 결과를 덮어쓰지 않는다. 결과는 `applied/stale/unconfirmed`로 구분한다.
- 교실별 일 200회 기본 상한은 DB `learning_courses.daily_calls`에서 설정한다. 날짜 경계는 **DB timezone** 기준이며, 한도 대기는 `quota`와 `available_at`으로 표시한다. 토큰 실비를 보장하는 과금 상한은 아니다.
- `/healthz`는 최근 DB 작업 루프 상태만 나타낸다. 모델의 교육적 정확성이나 공급자 정상 응답을 보증하지 않는다. API 키와 학생 원문은 로그에 기록하지 않는다.

## 시험

```sh
node --test scripts/unit/*.test.mjs
pnpm exec tsc -p tsconfig.foundation.json
pnpm typecheck
pnpm test:demo
pnpm build
```

`.github/workflows/learning.yml`은 일회용 PostgreSQL에서 001~005를 적용하고 실제 SQL 상태 전이·권한·중복·임대·재시도·할당량을 검사한다. 이후 Chromium에서 과학과 수학의 전체 흐름을 확인한다.

**시험 환경의 Supabase Auth 및 모델 응답은 명시적인 fixture**다. 브라우저, Next 서버, SQL 함수, 큐, 워커, 결과 반영은 실제 구현이다. 이것을 운영 Supabase 인증 통과나 실제 모델 정확도 평가로 발표하면 안 된다. fixture 서버는 NODE_ENV=test 및 로컬 DB를 강제한다. 실서비스 데이터나 유료 모델을 CI에서 사용하지 않는다.

## 남은 출시 승인 항목

실제 Supabase Auth/세션 갱신과 선택한 모델의 smoke test, 실운영 배포·로그 확인, 장시간 부하/백업 복원, 개인정보 보존·삭제 운영, 계정/교사 역할/등록 관리, 실제 교육과정 매핑과 교사 평가셋이 필요하다. 기존 과학 경로의 Cursor 워커·채팅까지 교체한 것은 아니다. 새 `/learn`은 독립 서버 워커를 사용하지만 구형 기록을 새 구조로 자동 이관하거나 재채점하지 않는다.

참고한 계약: Next.js Route Handlers, Supabase Database Functions/API Keys, PostgreSQL SELECT locking 문서. 운영 가이드의 외부 제품 가격이나 대회 마감일은 이 구현의 완료 기준에 포함하지 않는다.
