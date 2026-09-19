# 학습SOS 전환 · 프로덕션 준비 설계 v2

작성일: 2026-09-20 (Asia/Seoul)
감사 기준: `a31aa5b7bbc11c972e39c9a50ee9b3a92ade3f3a`
상태: **프로덕션 출시 승인 전. 이 문서는 구현 완료 보고서가 아니다.**

## 1. 제품 결정

과학 콘텐츠를 늘리는 것이 아니라 **학생의 설명에서 학습의 막힌 지점을 찾고, 근거가 있는 확인 활동을 제안한 뒤 설명의 변화를 재확인하는 학습지원 에이전트**로 확장한다. 저장소 이름은 유지해도 된다. 대외 이름 `학습SOS`는 제안이며 이번 패치에서 변경하지 않는다.

공통 흐름은 `답안·이유 → 교육과정/자료 범위 확인 → 오개념 가설 → 교사 승인 또는 보완 요청 → 확인 활동 → 설명 수정 → 전이 문항 → 교사 확인`이다. 일반 챗봇, 자유로운 인터넷 검색, 과목 메뉴만 추가하는 것으로 확장을 완료했다고 보지 않는다.

첫 확장 검증은 **과학 + 수학** 두 개의 작은 콘텐츠 팩으로 한다. 과학의 밀도 반례와 수학의 분수 크기 비교/수직선 활동은 공통 엔진과 다른 활동 렌더러를 검증하기에 적절한 후보이다. 실제 발행 전에는 각 학년·교육과정·성취기준·정답·루브릭을 검토해야 한다. 국어·영어·사회는 구조상 확장 가능성과 실제 제공 범위를 분리해서 표시한다.

## 2. 현재 코드에서 보존할 것

- `supabase/migrations/001_lab.sql`~`004_classroom.sql`: 역할과 학급을 확인하는 RPC, RLS/권한 회수, `security definer`의 빈 search_path, 트랜잭션 기반 상태 전이.
- `lab_act`, `lab_space_act`: 요청 UUID와 payload 비교를 통한 중복 요청 방지. `lab_act`의 optimistic version 검사.
- 교사 확인 후 활동 배정, 학생 원문 보존, AI 오류 시 교사 직접 검토 안내.
- 자료 답변의 인용 구절을 원문 부분 문자열과 대조하는 검증.
- `/demo`의 가상 학급/사전 작성 응답 표시. 이를 실제 AI 결과로 가장하지 않는다.
- 기존 데모 단위 테스트와 실제 계정을 사용하는 통합 검사. 테스트가 없는 프로젝트가 아니라, 검증 범위와 실행 환경을 분리할 필요가 있는 프로젝트다.

## 3. 이번 패치의 범위

`src/lib/server/api-http.ts`와 두 API route에 아래 변경을 적용한다.

| 항목 | 이번 변경 | 남은 검증 |
|---|---|---|
| 오류 계약 | JSON 400, 인증 401, 권한 403, 미존재 404, 충돌 409, 본문 과대 413, 형식 415, 검증 422, 제한 429, 장애 500/503 구분 | 실제 Supabase 오류 응답과 화면 행동 확인 |
| 본문 제한 | Content-Length를 믿지 않고 실제 UTF-8 스트림 바이트 계산. lab 16 KiB, space 256 KiB | Vercel 경계 및 느린 업로드/요청 중단 시험 |
| 인증/DB 장애 | GET 예외 처리, space 설정 누락 처리, 로그아웃 오류 확인, 재평가 RPC 실패/빈 결과 확인 | 세션 만료·갱신·인증 서버 장애 E2E |
| 추적/노출 방지 | 요청별 ID, 안전한 오류 코드, no-store/nosniff. 서버 장애 로그에 원문·SDK 오류·비밀번호 제외 | 배포 로그/에러 수집 서비스의 보관·마스킹 확인 |
| 회귀 검사 | 외부 서비스 없이 실행하는 HTTP helper 테스트와 CI 정의 | CI의 실제 실행 결과 및 route/브라우저 E2E |

Origin 검사는 기존의 요청 origin과 설정된 APP_ORIGIN 허용 구조를 보존한다. APP_ORIGIN은 http(s) origin이어야 하며 경로/쿼리/인증 정보를 넣지 않는다. 서비스 쪽에 분산 rate limiter를 새로 만들었다는 뜻은 아니다. 429의 Retry-After는 다음 재시도까지의 최소 대기 안내이지 quota가 정확히 초기화되는 시간의 보증이 아니다.

**이번 패치에서 하지 않은 것:** 운영 DB 변경, 배포, AI 제공자 전환, 워커 교체, 과목 팩 실제 발행, 프런트엔드 요청/폴링 재설계, 실제 학생 정보 처리 승인, 전체 E2E/부하 검증. 이 항목들이 미완료인 동안 프로덕션 준비 완료라고 표시하지 않는다.

## 4. 출시를 막는 확인 사항

| 우선순위 | 코드 근거 | 문제와 완료 조건 |
|---|---|---|
| P0 | README, `scripts/cursor-worker.mjs` | Windows PC/대화형 Cursor 로그인에 의존. 개인 PC를 끈 상태에서도 배포된 서비스의 진단·채팅이 완료되어야 한다. |
| P0 | `cursor-worker.mjs` 분석 SELECT limit 1, `lab_ai_claim` | 오래된 pending 작업을 먼저 읽고 claim 실패 시 다음 후보를 찾지 않는다. 여러 워커에서도 실행 가능한 다음 작업을 원자적으로 선점하고 기아 상태가 없어야 한다. |
| P0 | `lab_ai_finish`, `lab_chat_finish`, worker | 완료 RPC의 boolean false를 워커가 성공처럼 로그할 수 있다. 만료/교체된 lease의 완료는 거부하고 false도 명시적으로 실패 처리한다. 기존 lease는 002 이후 90초이다. |
| P0 | `lab_ai_budget`, claim RPC | 분석·채팅이 하루 100회 한도를 공유한다. 한도 도달 시 대기가 계속되지 않도록 quota 상태/재개 시각/교사 대체 경로를 표시한다. |
| P0 | `Workspace.tsx` request/refresh | 재호출마다 새 UUID, 겹칠 수 있는 5초 폴링, 늦은 응답 덮어쓰기 가능. 연결 끊김 후 같은 의도 재전송은 동일 키, GET에는 취소/세대 검사, 쓰기에는 중복 효과 방지가 필요하다. |
| P0 | `003_lessons.sql` lab_act | HTTP에서만 choice 값을 검사한다. 직접 RPC 호출에서도 문항·보기·활동·가설의 유효한 조합을 거부/허용해야 한다. |
| P0 | `001_lab.sql`, `004_classroom.sql` | 학급 권한을 구현했지만 전체 테넌트 격리를 검증한 것은 아니다. 서로 다른 학급/역할/직접 REST·RPC 요청의 부정 테스트가 필요하다. |
| P1 | `content.ts`, `lessons.json`, SQL check, worker prompt | 콘텐츠/상태/프롬프트/DB가 과학·밀도에 결합. 버전이 있는 과목 팩과 공통 엔진으로 분리하고 두 과목에서 한 사이클을 검증한다. |
| P1 | worker proposal schema/prompt/finish | 적절한 설명도 hold로 분류하고 reason_status를 최종 저장하지 않는다. 근거 부족/오개념 의심/적절한 설명/범위 밖을 별도 판정으로 저장한다. |
| P1 | `lab_list`, `lab_space`, Workspace | 모든 기록·자료·대화를 전송하고 5초마다 반복한다. 화면별 페이지 조회/커서/변경분 갱신으로 부하와 노출 범위를 줄인다. |
| P1 | worker processChat | 키워드 매칭 상위 3개 자료의 앞 3000자만 사용한다. 근거가 자료 뒤에 있는 질문과 한국어 변형 표현을 평가하고 청크 단위 검색을 도입한다. |
| P1 | docs/README, `/demo`, tests | 데모와 라이브 기능/집계의 설명을 맞춘다. CI 통과, live E2E, 교육적 정확성 평가를 서로 다른 증거로 제시한다. |

## 5. 목표 아키텍처

기존 Next.js + Supabase를 유지한다. 프레임워크 전면 교체나 다수의 마이크로서비스는 필요하지 않다.

```text
학생/교사 웹
   │ 인증된 요청, 요청 UUID, 관측 가능한 작업 상태
   ▼
Next.js API ── 권한·입력·상태 검증 ── Supabase/Postgres
                                      │ 답안 + durable job (같은 트랜잭션)
                                      ▼
                               상시 실행 AI 워커
                         선점/lease/재시도/예산/모델 API
                                      │
                     팩 기반 도구 + 근거/스키마/범위 검증
                                      ▼
                         제안 저장 → 교사 검토 대기
```

Cursor CLI는 개발용 선택지로만 남기고 라이브 경로는 서버용 API 어댑터로 전환한다. 제공자·모델·호스팅 상품은 비용 한도와 계정 조건을 확인해서 정하며 키를 저장소나 브라우저에 넣지 않는다. 데이터베이스 저장 성공 후 메모리만으로 잡을 생성하면 안 된다.

### Durable job 계약

`job_id, tenant_id, kind, record_id, input_version, status, attempt_count, max_attempts, next_attempt_at, lease_token, lease_until, created_at, started_at, completed_at, error_code, model, prompt_version, curriculum_version`를 가진다. 분석·수업 채팅·외부 자료 추천은 kind로 구분한다.

상태는 queued/running/retry_wait/succeeded/failed/cancelled로 명확하게 한다. claim은 `FOR UPDATE SKIP LOCKED`와 예산 예약을 트랜잭션으로 처리한다. 재시도는 네트워크/429/일시적 5xx에만 지수 backoff+jitter로 제한하고, 스키마/근거 실패의 수정 시도도 상한을 둔다. 오류일 때 정상 진단을 꾸며내지 않는다.

lease 갱신과 만료 검사, 입력 version fencing, provider timeout, 워커 종료 시 정리, 오래된 작업 회수, 실패 큐, 교사 수동 처리, 작업별 처리 이력을 구현한다. 모델 호출은 재발생할 수 있어도 결과 반영은 논리적으로 한 번이어야 한다. 일별 한도는 전체/학급/사용자 수준으로 분리하고 실비·예상 토큰을 관찰한다. 원문 전체를 일반 로그에 남기지 않는다.

## 6. 과목 팩 설계

| 개체 | 필수 정보 |
|---|---|
| CurriculumPack | id, subject, grade_band, curriculum_version, version, status(draft/reviewed/published), reviewer |
| Concept | 개념 ID, 선수 개념 ID, 범위와 제외 범위, 성취기준 참조 |
| Item | 팩/버전, concept_ids, prompt, response_schema, 정답·범위·루브릭의 서버 전용 참조 |
| Misconception | 개념별 가설 ID, 관측 가능한 단서, 반례, 배제 조건 |
| Activity | kind, 입력 계약, 렌더러, 승인된 관찰/재료, 적용 가능한 가설 |
| EvidenceSource | 원문 출처, 문서 버전, 구절/구간 위치, 사용 범위, 검토 상태 |
| Assessment | aligned / misconception_suspected / insufficient_evidence / out_of_scope, evidence_refs, suggested_activity_ids, teacher_review |

`Activity.kind`는 simulation, worked_example, number_line, evidence_comparison, guided_question 등으로 구분한다. 과학의 부력 그림이나 float boolean을 수학·독해에 강제로 적용하지 않는다. 팩 발행 시 문항/보기/전이 문항/활동/루브릭 참조가 닫혀 있는지 검사하고, 학생 시도는 발행 당시 버전에 고정한다. 정답과 숨겨진 채점 기준은 학생 번들에 넣지 않는다.

기존 D01~D20 ID는 호환 매핑으로 유지한다. DB check에 과목 코드를 계속 추가하기보다 콘텐츠 카탈로그의 FK/참조 무결성과 RPC 검증을 사용한다. 먼저 additive migration, 기존 데이터 backfill, dual-read 검증을 거친 후 구형 제한을 제거한다. 운영 데이터를 삭제하거나 기존 attempt를 새 루브릭으로 소급 채점하지 않는다.

## 7. 에이전트 도구와 신뢰 경계

학생 답안에서 필요한 정보를 식별하고, 승인된 자료를 찾고, 명시적 규칙과 루브릭으로 가설을 제안하고, 근거를 확인하고, 교사의 승인을 요청하는 제한된 실행기를 구현한다. LLM 수를 늘리는 것이 에이전트성의 기준은 아니다.

도구 예: `load_curriculum_scope`, `retrieve_class_materials`, `check_response_rules`, `propose_misconception`, `validate_evidence`, `recommend_activity`, `request_teacher_review`, `prepare_transfer_check`.

tenant/student/role은 모델 출력이 아니라 서버 세션에서 주입한다. 프롬프트의 "명령을 따르지 말라"만으로 보안을 보장하지 않는다. 도구 allowlist, 입력 스키마, DB 권한, 승인된 콘텐츠와 실제 원문 인용 검증이 필요하다. 외부 URL은 별도의 fetch 경계/allowlist/리다이렉트·사설주소 차단/본문 제한이 준비되기 전까지 임의로 열지 않는다. 현재 외부 채팅은 세 사이트 추천이지 웹 검색이 아니다.

교사 화면에는 도구 실행 요약, 사용 근거, 판정 사유 요약, 보류 이유, 모델/프롬프트/콘텐츠 버전을 제시한다. 내부 추론 전문을 노출할 필요는 없다. 범위가 없거나 자료가 부족하면 보류하고 교사에게 연결한다. AI가 직접 성적 확정, 학생 낙인, 미승인 활동 배정을 하지 않게 한다.

## 8. 화면·인증·운영

읽기와 쓰기의 retry 정책을 구분한다. 쓰기 요청은 사용자의 한 의도에 UUID를 부여하고 응답 유실 시 같은 UUID와 같은 payload로만 재전송한다. 새 의도에는 새 키가 필요하다. 비밀번호를 outbox/localStorage에 저장하지 않는다. 학생 초안 저장이 필요하면 계정별 격리/로그아웃 삭제/TTL을 먼저 정한다.

GET 폴링에는 single-flight, AbortController, 세대 번호/최신 응답 확인, 탭 비활성화 정지, jitter/backoff를 적용한다. 로그아웃 시 이전 요청을 무효화해서 이전 계정 기록이 복원되지 않아야 한다. 요청 성공 후 refresh 실패는 "저장은 완료, 최신 화면 조회 실패"처럼 분리한다.

회원 온보딩은 학교/학급 생성과 교사 초대, 만료되는 참여 코드, 역할 변경 이력, 교사 소속 확인을 설계한다. 개인의 비밀번호를 공유하는 데모를 운영 계정으로 확대하지 않는다. 원문·피드백·대화에 대한 보관/삭제/열람 정책을 정하고 실제 아동·학생 데이터 도입 전에 별도의 적합성 검토를 거친다. 민감 데이터 없는 독립된 심사 계정을 제공한다.

오류 수집, request/job ID, 워커 heartbeat, 큐 나이, 실패율, 비용, 원문 유출 없는 로그, 관리자 재처리, DB 백업 및 복원 리허설, 기능 플래그, 이전 배포 롤백 절차를 운영 문서에 둔다. health endpoint는 로그인 키나 사용자 데이터를 응답하지 않는다.

## 9. 출시 승인 기준 — 모두 아직 검증이 필요한 목표

1. **기능:** 새 계정/기존 계정, 과학/수학, 교사/학생의 두 과목 전체 사이클. 새로고침·중복 클릭·네트워크 단절·세션 만료 후 복구. 로그인과 무관한 공개 라이브/데모 상태 표시가 정확해야 한다.
2. **권한:** 학급 A 교사/학생이 학급 B의 기록·자료·피드백·채팅·토론을 ID 조작, 직접 REST/RPC, stale session으로 읽거나 쓸 수 없어야 한다. 학생이 교사 정답/AI 내부 제안/승인 기능에 접근하지 못해야 한다.
3. **작업:** 워커 두 개, 워커 종료/재시작, expired lease, 제공자 429/5xx/timeout, quota 소진에서 중복 반영과 무한 대기가 없어야 한다. 정상 성공률과 복구 성공률은 나눠 측정한다.
4. **교육 품질:** 정상 설명, 전형적 오개념, 단답/무응답, 근거 부족, 교육과정 범위 밖, 인용 조작, 프롬프트 주입을 포함한 교사 검토 평가셋을 과목별로 만든다. 성능 수치는 실제 평가 후에만 발표한다.
5. **성능:** 우선 50명 동시 사용 파일럿 부하를 가정해 측정하고 증가시킨다. API p95 2초, AI 작업 p95 30초를 초기 목표로 제안하되 측정 결과/모델/입력 길이와 함께 조정한다. 아직 달성 수치가 아니다.
6. **운영:** 개인 PC를 끄고도 성공. staging에서 마이그레이션·복원·롤백 리허설. 심사 기간 내 URL/로그인/워커 유효성 확인. 개인정보/키/학생 원문이 공개 리포트나 일반 로그에 없어야 한다.

## 10. 변경 묶음 순서

- **PR 1 (이번 묶음):** HTTP 경계, 오류 계약, 독립 테스트, CI, 출시 차단 항목의 근거 문서. 이것만으로 전체 안정화가 완료되지는 않는다.
- **PR 2:** 상시 서버형 AI 어댑터, durable jobs, lease/재시도/예산/heartbeat, 오류 시 교사 대체, 격리된 Postgres 통합 검사.
- **PR 3:** RPC 입력/콘텐츠 무결성, 학급 격리 부정 검사, 페이지 조회, 브라우저 요청 UUID 유지·폴링 경합·세션 갱신.
- **PR 4:** 팩 기반 엔진, 과학 마이그레이션, 검토된 수학 팩, 두 과목 전체 E2E.
- **PR 5:** 근거 검색/에이전트 trace, 교육 품질 평가, 관리/보관/복원/부하 리허설, 라이브 심사 계정 및 제출 자료.

API/스키마 패치를 한꺼번에 main에 넣지 않는다. 각 묶음은 재현 테스트, 테스트 데이터, 마이그레이션 호환성, 롤백 방법, 완료/미완료 범위를 남긴다.

## 11. 원티드 제출 확인

공식 2026 AI Championship 안내 기준, 참가 신청은 9월 18일 23:59:59, 과제 제출은 **9월 20일 23:59:59**이다. 참가 등록을 마친 상태인지와 제출 마감은 구분한다. 실제 동작 URL·문제 정의·AI 활용/도구 설명을 준비하며, 가상 데모를 실제 AI 처리 증거로 제출하지 않는다. 서비스 중단은 심사에서 불리하거나 제외 사유가 될 수 있으므로 오늘의 제출 가능성과 정식 프로덕션 승인을 분리한다.

공식 안내: https://static.wanted.co.kr/ai-championship/2026/landing.html
기술 참고: https://nextjs.org/docs/app/api-reference/file-conventions/route
Supabase 함수/권한: https://supabase.com/docs/guides/database/functions
Supabase 출시 점검: https://supabase.com/docs/guides/deployment/going-into-prod
