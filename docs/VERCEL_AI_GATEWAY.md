# Vercel AI Gateway — 학습 워커 연결

2026-09-20. `/learn` 분석의 기본 공급자는 Vercel AI Gateway다. 별도 OpenAI/Groq 계정 키는 필요하지 않다. 기존 `/` 과학 교실의 Cursor 채팅 경로까지 교체하는 변경은 아니다.

## 인증과 실행 위치

웹 → 인증된 `/api/learning` → PostgreSQL 영속 큐 → 독립 워커 → Gateway → 스키마·원문 근거 검증 → `learning_finish` → 교사 검토.

웹은 계속 Vercel에 둘 수 있다. Gateway는 추론 API이지 영속 워커 호스팅이 아니므로, 웹 프로젝트 연결만으로 Docker 워커가 자동 실행되지는 않는다. 현재 장시간 실행 워커는 `AI_GATEWAY_API_KEY`를 사용한다. Vercel 프로젝트가 연결되어 있다는 사실과 Gateway 키/크레딧/모델 호출 권한은 별개다. 짧은 수명의 `VERCEL_OIDC_TOKEN`을 복사해 장기 워커 키처럼 사용하는 동작은 지원하지 않는다.

`.env.learning.example`을 참고해 비공개 `.env.worker` 또는 워커 호스팅 서비스의 Secret에 설정한다.

```dotenv
LEARNING_MODEL_PROVIDER=vercel
AI_GATEWAY_API_KEY=<서버의 Secret으로만 설정>
LEARNING_MODEL=openai/gpt-oss-120b
LEARNING_MODEL_MAX_OUTPUT_TOKENS=2048
LEARNING_GATEWAY_PRIVACY=zdr
```

`openai/gpt-oss-120b`는 설정 예시이며 무료 모델이라는 뜻이 아니다. 검증한 모델 ID로 교체할 수 있지만 자동으로 다른 모델을 선택하거나 비용이 다른 대체 모델로 우회하지 않는다. Endpoint는 `https://ai-gateway.vercel.sh/v1/chat/completions`로 고정하고 리다이렉트를 차단한다. 기존 `LEARNING_MODEL_ENDPOINT`, `LEARNING_MODEL_API_KEY`는 Gateway 설정에서 제거한다. 불명확하게 섞인 자격증명은 시작 단계에서 거부한다.

## 무료 테스트와 개인정보 조건

공식 가격 안내 기준 무료 tier는 매월 $5 크레딧이며 무제한 무료 추론이 아니다. 크레딧 구매 후에는 유료 tier로 전환되어 월 무료 크레딧이 적용되지 않는다고 안내되어 있다. 실제 팀 잔액·등급은 이 패치가 확인하거나 변경하지 않는다. 코드가 충전/자동 충전/구매/플랜 변경을 하지 않는다.

모든 Gateway 요청은 `disallowPromptTraining: true`를 보낸다. 안전한 기본값 `LEARNING_GATEWAY_PRIVACY=zdr`는 `zeroDataRetention: true`도 요구한다. 공식 안내상 요청별 ZDR은 Pro/Enterprise 조건이 있으므로 무료 계정에서 사용할 수 있다고 주장하지 않는다.

Hobby/무료 계정에서 **실제 학생 자료가 아닌 합성 테스트 데이터만** 사용할 때 운영자가 명시적으로 다음 설정을 선택할 수 있다.

```dotenv
LEARNING_GATEWAY_PRIVACY=synthetic
```

이 모드는 prompt training을 계속 차단하지만 ZDR을 요구하지 않는다. 요청 실패 후 코드가 이 모드로 자동 변경하거나 제한을 끄지 않는다. 자료가 실제 학생 데이터인지 자동 판별하는 기능은 없으며, synthetic 설정은 실제 학생 자료 사용의 허가가 아니다. 실제 학생 공개 전에는 담당자의 데이터/연령/공급자 약관 검토, 계정 정책, 개인정보 보존·삭제 기준이 필요하다. Gateway 정책만으로 이 검토를 대체할 수 없다.

선택적으로 `LEARNING_GATEWAY_PROVIDERS=groq,cerebras`처럼 검토한 공급자 slug를 제한할 수 있다. 이는 예시이며 각 공급자의 현재 모델·스키마·ZDR 지원을 확인해야 한다. 목록을 비우면 동일 모델의 정책 적합 공급자 사이 라우팅은 Gateway가 결정한다. 다른 모델로의 fallback 목록은 보내지 않는다.

## 요청과 응답 계약

Gateway에는 `json_schema`, `strict: true`, `additionalProperties: false`로 interpretation/evidence/quote/note 네 필드를 요청한다. 그 뒤 앱에서도 필드·길이·정확한 원문 인용을 재검증한다. 모델이 구조화 응답을 지원하지 않으면 실패 처리하고 임의로 느슨한 JSON 모드로 낮추지 않는다. 스키마 준수나 부분 문자열 인용 일치는 교육적 판단의 정확성을 보증하지 않는다.

응답의 유효한 upstream 모델 ID와 `requestedModel`을 따로 저장한다. `gateway.requestedPrivacy`는 **요청한 정책의 기록**이지 실제 데이터 처리에 대한 독립 감사 증명은 아니다. 모델의 tool call/refusal/잘린 응답은 분석 성공으로 저장하지 않는다. 토큰 통계는 숫자 허용 목록만 저장하고 원문·키·임의의 provider metadata는 일반 로그로 출력하지 않는다.

## 장애와 비용 처리

| 상황 | 저장 코드 | 자동 재시도 |
|---|---|---|
| HTTP 402: 크레딧 또는 예산 제한 | provider_credit | 하지 않음 |
| 인증/권한 거부 | provider_auth | 하지 않음 |
| 구조화된 no_providers_available | provider_policy | 하지 않음 |
| 잘못된 요청/모델/스키마 계약 | provider_request | 하지 않음 |
| 408/429/5xx, 연결·시간 초과 | provider_unavailable/timeout/network | 기존 DB의 최대 3회 정책 |
| 형식 오류·위조된 인용 | invalid_output/invalid_evidence | 하지 않음 |

실패한 작업에도 학생 원문과 교사 검토 경로는 남는다. 기존 학생 UI에는 일반 분석 실패·교사 직접 검토 안내가 표시되고, API의 `job.error_code`에 구체적인 코드가 기록된다. 새 오류를 저장하려면 **워커 배포 전에 006 마이그레이션을 적용해야 한다.** DB도 결제·권한·정책 오류의 재시도를 거부한다. 운영자가 재설정하기 전 다른 모델/직접 공급자 키로 우회하지 않는다.

일일 호출 한도와 출력 토큰 한도는 달러 단위 지출 보증이 아니다. Gateway Dashboard의 키/팀 예산, 크레딧 잔액, 자동 충전 설정을 별도로 관리한다. 소진된 크레딧을 감지했다고 앱이 유료 크레딧을 자동 구매하지 않는다. 단일 작업 한도는 유지하지만 전체 워커를 자동 재기동하거나 이미 실패한 모든 작업을 자동 재제출하지 않는다.

## 연결 점검

추론·DB 변경 없이 Gateway 인증, 잔액과 공개 모델 목록을 조회한다.

```sh
node --env-file=.env.worker scripts/learning-gateway-check.mjs
```

보고서 `inferenceChecked:false`는 GET 조회까지만 성공했다는 뜻이다. 모델 목록에 있다는 사실만으로 이 팀의 모델 접근권한·스키마·ZDR 지원이 확인되지는 않는다.

운영자가 비용 발생을 승인한 환경에서만 `--smoke`를 지정한다. 합성 질문 한 건으로 실제 추론을 수행하며 재시도하지 않는다. 실제 학생 데이터나 DB는 사용하지 않는다.

```sh
node --env-file=.env.worker scripts/learning-gateway-check.mjs --smoke
```

## 배포 및 검증 순서

1. 기존 문서대로 001~005 정합성을 확인한다. 기존 수동 적용 DB에 001~004를 재실행하지 않는다.
2. 격리 staging에서 `006_gateway_failures.sql`을 한 트랜잭션으로 적용한다. 기존 005는 수정하지 않는다.
3. 비공개 워커 환경을 설정하고 GET 점검 및 승인된 합성 smoke test를 실행한다.
4. 기존 Compose 워커를 새 코드로 재배포한다. 웹의 역할별 데이터 반환은 기존 계약을 유지한다.
5. CI의 두 과목 전체 여정 외에 실제 Supabase 인증·선택 모델 품질·장기 운영을 따로 검증한다.

CI는 명시적으로 `compatible` + 로컬 fixture를 사용하며 live 키를 제거한다. Gateway 계약 테스트는 주입한 HTTP 응답으로 검증한다. 이것은 실제 Gateway 호출/실계정 잔액/실서비스 배포 검증을 대신하지 않는다.

## 공식 참고 자료

- https://vercel.com/docs/ai-gateway/pricing
- https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/structured-outputs
- https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api
- https://vercel.com/changelog/zero-data-retention-no-prompt-training-on-ai-gateway
- https://vercel.com/docs/ai-gateway/authentication-and-byok
- https://vercel.com/ai-gateway/models/gpt-oss-120b
