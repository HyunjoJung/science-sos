# 학습SOS · 서버형 다과목 실행 경로

## 범위와 신뢰 경계

`/learn`은 과학·수학·독해 예제 팩의 **제출 → 교사 검토 → 활동/설명 보완 → 전이문항 → 최종 확인**을 실제 DB에 연결한다. 기존 `/` 과학 교실과 기록은 그대로 유지한다. 예제 팩은 공식 교육과정 검증·학습 효과 검증을 마친 콘텐츠가 아니며 교사가 문항, 정답, 수업 범위, 활동을 검토하고 명시적으로 배정해야 한다. 단원 전체나 모든 과목 지원을 의미하지 않는다.

AI는 제안만 저장한다. 정상 이해와 근거 부족, 문항/범위 문제를 구분하며 정상 이해는 교사 승인 후 교정 활동 없이 전이문항으로 이동할 수 있다. AI 처리 실패를 학생의 오개념으로 기록하지 않는다. 학생은 자기 기록만, 교사는 자신이 등록된 수업의 기록만 접근한다. 정답 키와 AI 분석은 학생 응답에서 제외하며 배정하지 않은 활동·전이문항은 단계에 따라 숨긴다.

## 코드 구성

- `src/app/learn`, `src/components/LearningWorkspace.tsx`: 실제 교사/학생 화면, 수업·초대·자료·학습 흐름·질문.
- `src/app/api/learning`: 세션, 동일 출처, 요청 크기/시간, 계정 변경 방어, 안전한 오류 계약.
- `src/lib/runtime`: 동작별 입력 검증, 안정적 요청 ID, 취소/늦은 조회 응답 방어, 원문 청크 검색.
- `src/lib/learning/model.ts`: 모델 API 어댑터와 근거·활동 allowlist·정답 규칙 검증.
- `scripts/learning-worker.mjs`: 상시 서버 워커, 임대 갱신, 재시도, 동일 결과 재저장, 안전한 health endpoint.
- `005_legacy_contract.sql`: 기존 RPC의 보기 검증과 직접 호출 우회 방지. 기존 상태 전이는 비공개 함수로 보존.
- `006_learning_runtime.sql`: 수업·등록·팩·시도·자료·대화·승인·이력·권한·멱등성.
- `007_learning_jobs.sql`: 원자적 작업 선점, 임대/입력 버전 검사, 예산, 실패·재시도.
- `008_learning_examples.sql`: 검토가 필요한 창작 예제 3개. 자동 배정하지 않는다.

## 개발·검증

Node 22, 저장소에 고정된 pnpm을 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:demo
pnpm typecheck:foundation
pnpm typecheck
pnpm build
python -m pip install -r scripts/browser/requirements.txt
python -m playwright install chromium
pnpm test:browser
```

브라우저 시험은 실제 Next 프로덕션 빌드와 **모의 API**를 사용한다. 실제 Supabase/모델 전체 연결 시험이라고 표시하지 않는다. DB 시험은 실제 PostgreSQL에서 별도로 실행하며 호스팅된 DB에서 실행하지 못하도록 대상 검사를 한다.

```sh
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/science_sos_test
export ALLOW_DISPOSABLE_DATABASE=yes
bash scripts/db/run.sh
```

`bootstrap.sql`은 임시 Postgres에서 Supabase의 최소 auth 역할/함수를 대체한다. 실제 Auth 서비스, PostgREST, 메일 전송까지 대체·검증하는 것은 아니다. CI는 중복 요청 20개, 병렬 워커 선점, 교사 검토와 결과 반영 경합도 검사한다. 실제 모델을 사용하는 기존 통합 시험은 `pnpm test:integration`, `pnpm test:classroom`이며 기본 CI가 실행하지 않는다.

## DB 이전

**실제 운영 DB에 `scripts/db/*`를 실행하지 않는다.** 기존 프로젝트는 001–004를 SQL Editor에서 적용했으며 CLI 이력이 비어 있었다. 현 DB의 함수·테이블·권한과 저장소를 비교하고 백업을 확보한 뒤 staging에서 먼저 검증한다. 기존 001–004를 다시 실행하거나 이력을 확인 없이 강제로 등록하지 않는다.

기존 001–004와 일치하는 DB에는 005–008을 순서대로 적용한다. 새 격리 DB에는 001–008을 적용한다. 005는 기존 `lab_act` 구현을 private로 옮기고 호환 wrapper를 제공한다. 006은 기존 반별로 수업과 등록 관계를 만들되 과거 답안은 수정하지 않는다. 실제 학교·기관 분류는 반 이름을 임의로 합치는 대신 운영자가 검토한 명시적 소속 데이터로 이전해야 한다.

코드 롤백은 이전 웹 배포/레거시 워커를 다시 사용하면 된다. 새 테이블을 삭제해 롤백하지 않는다. 이미 생성한 신규 기록은 보존하고, DB 복원 여부는 별도의 백업·복구 계획으로 결정한다. CI의 임시 DB 덤프/복원 성공은 호스팅 서비스의 실제 백업 복구를 검증한 것이 아니다.

## 웹 배포

Vercel 등 Next 지원 환경에 다음만 설정한다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
APP_ORIGIN=https://실제-웹-호스트
```

서비스 키와 모델 키는 웹 배포/브라우저에 두지 않는다. 운영과 preview의 origin은 각각 정확하게 설정한다. `/learn` 로그인은 Supabase Auth에 마련된 계정을 사용한다. 교사 권한은 임의 가입으로 부여되지 않으며 기존 교사는 수업을 추가하고 만료되는 코드로 학생을 초대할 수 있다. 계정 생성·비밀번호 재설정·메일/CAPTCHA 정책은 현재 조직의 Auth 운영 절차를 따른다. 미성년자 동의·보관·삭제 정책을 이 코드만으로 해결했다고 주장하지 않는다.

## 상시 워커 배포

`.env.worker.example`을 안전한 서버 비밀 저장소로 옮겨 실제 값만 서버 환경에 설정한다. 키를 Git이나 채팅에 붙여 넣지 않는다.

```sh
# 로컬 개발용. 서비스 운영은 아래 컨테이너를 상시 실행 환경에 배포한다.
pnpm worker

docker build -f Dockerfile.worker -t learning-sos-worker .
docker run --rm --env-file .env.worker -p 8080:8080 learning-sos-worker
```

`AI_ENDPOINT`는 승인한 API 공급자의 전체 HTTPS Chat Completions 주소이다. `AI_MODEL`도 명시적으로 지정한다. 기본 토큰 필드는 `max_completion_tokens`이며 호환 공급자가 기존 필드를 요구할 때만 `AI_TOKEN_PARAMETER=max_tokens`로 설정한다. 선택한 실제 공급자가 JSON 응답 형식과 이 계약을 지원하는지 별도 smoke test가 필요하다. 추론에 Cursor CLI/개인 PC가 필요하지 않다. 기존 교실 전용 워커는 `pnpm worker:legacy`로 분리했다.

`GET /healthz`는 DB와 최근 워커 연결 여부만 반환한다. 모델 품질·API 잔액이 정상이라는 보증이 아니다. 워커를 두 개 이상 띄워도 lease와 입력 버전으로 중복 결과 반영을 차단한다. 추론 호출 자체는 장애 복구 과정에서 재발생할 수 있다. 과금의 exactly-once를 보장하지 않는다.

## 비용·장애 제어

기본 전체 한도는 **UTC 하루 모델 호출 예약 100단위**이다. 수업/작업 종류별 한도도 기본 100이다. 분석은 1단위, 자료 답변은 생성+근거 검사에 최대 2단위를 예약한다. 실제 토큰·금액 한도가 아니므로 모델별 청구 제한도 공급자 측에서 설정해야 한다. 초기 보류나 장애 때도 예약을 보수적으로 유지한다. 워커 재시도도 예산에 포함한다. 운영자가 private 한도를 조정하지 않는 한 수업을 추가해 전체 한도를 우회할 수 없다.

예산 소진은 `budget_wait`와 다음 UTC 초기화 시각으로 표시한다. 재시도는 최대 3회, 지수 backoff+jitter, lease 120초/갱신 20초이다. 제공자 오류와 근거 검증 실패는 코드로만 남긴다. 완료 응답을 잃으면 같은 결과를 다시 저장하고, 저장 장애를 모델 실패로 바꾸어 오류 답변을 덮어쓰지 않는다. 교사가 먼저 처리했거나 자료 버전/공개 여부가 바뀌면 오래된 결과는 반영하지 않는다.

## 자료와 인용

키워드 기반 청크 검색이 문서 전체를 대상으로 동작한다. 벡터 검색이나 PDF 자동 추출이 구현됐다고 표시하지 않는다. 답변의 원문 인용을 문자열과 문서 버전으로 검증하고, 모델의 추가 함의 검사도 사용하지만 이 역시 오류 가능성이 있는 보조 수단이다. 문서 비공개/변경은 진행 중 결과의 반영을 막고 이미 표시할 답변에서도 해당 출처를 숨긴다.

## 출시 판단

마감일이 아니라 다음 증거로 판단한다: 코드/독립 시험, 실제 PostgreSQL 권한·상태·경합 시험, 브라우저 사용자 흐름, staging의 실제 Supabase+모델 통합, 호스팅 워커 재시작/복구, 실제 백업 복원, 부하 측정, 교사 콘텐츠·교육적 품질 검토. 앞 세 가지 성공만으로 나머지나 실제 학생 서비스 승인을 완료했다고 표시하지 않는다. 현재 실행 결과와 남은 항목은 PR의 검증 기록을 기준으로 한다.
