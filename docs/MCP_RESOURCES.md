# MCP 자료 연결 (2026-09-20)

## 구현 범위

두 방향의 연결을 구현한다. `/api/mcp`는 공개 학습자료 디렉터리를 제공하는 MCP 서버다.
독립 학습 워커는 공식 MCP Client SDK를 사용해 같은 웹 배포의 `/api/mcp`에 접속하고
`search_learning_resources`를 호출한다. 기본 분석은 여전히 Vercel AI Gateway를 사용한다.
학생 답안은 Gateway의 기존 분석 경계에만 전달하며 MCP에는 과목/주제 코드만 전달한다.
MCP 결과는 채점 프롬프트에 넣지 않는다. 모델이 임의로 도구/URL을 고르는 루프가 아니라,
팩 메타데이터로 결정되는 제한된 자료 조회 단계다. 분석 한 시도당 Gateway 호출 1회는 변하지 않는다.

자료 후보는 자동 배정되지 않는다. 교사가 현재 링크·언어·학년·접근 조건을 확인하고
교사 화면의 체크박스와 전달 버튼으로 승인해야 학생의 해당 기록에 표시된다.
전달/철회는 인증된 `/api/learning` → `learning_resource_act`로만 처리한다.
공개 MCP에는 해당 쓰기 도구, 학생 답안, 계정/반 정보 또는 숨겨진 정답이 없다.

## 공개 MCP 계약

- `list_learning_topics({})`: 현재 지원하는 두 과목/주제 코드와 목록 버전.
- `search_learning_resources({subject, topic})`: `science/density`, `mathematics/fractions`.
- `get_learning_resource({resource_id})`: 등록된 ID의 링크와 확인일.
- 리소스 `learning-sos://catalog/info`, 프롬프트 `teacher_resource_review`.
- 모든 도구는 읽기 전용이며 임의 URL 요청·개인정보 입력·모델 호출이 없다.
- `mcp-handler@2.2.0`, MCP SDK server/client `2.0.0` 고정. 2026-07-28 프로토콜과
  2025-era Streamable HTTP를 같은 핸들러에서 지원한다. Redis, SSE 구형 엔드포인트,
  세션별 메모리 저장, 실험적 WebMCP는 사용하지 않는다.
- 서버 공개 기본값은 OFF. 켜면 누구나 조회할 수 있는 **공개 자료 전용** 서버다.
  OAuth를 흉내 낸 서비스 키 공유나 Supabase 토큰 전달을 사용하지 않는다.
  비공개 학급 MCP를 추가하려면 별도의 audience 검증 OAuth/권한/동의 설계가 필요하다.

## 외부 자료의 의미

EBSMath, Khan Academy, PhET 공식 링크 4개를 직접 검토해 등록한 **작은 링크 디렉터리**다.
해당 기관의 공식 MCP/API와 연결했다고 주장하지 않는다. EBSMath는 포털 진입점이고,
PhET 두 항목은 시뮬레이션 안내, Khan 항목은 분수 단원 페이지다. 실시간 본문 검색,
강의 다운로드/임베딩/스크래핑, 무료 접근 보장, 교육과정 인증, 학습효과 검증이 아니다.
확인일은 정적 목록의 편집일이며 요청할 때마다 URL이 재검증된다는 뜻이 아니다.
제3자 사이트의 이용·연령·개인정보 조건은 실제 학생 배포 전 담당자가 검토한다.

등록 URL:
- https://phet.colorado.edu/en/simulations/buoyancy
- https://phet.colorado.edu/en/simulations/fractions-intro
- https://www.ebsmath.co.kr/
- https://www.khanacademy.org/math/arithmetic/arith-review-fractions

## 활성화 순서

1. staging에 005/006이 적용된 것을 확인하고 **007_learning_resources.sql**을 한 트랜잭션으로 적용한다.
   기존 이력이 수동 적용이면 001~006을 다시 실행하지 않는다. 이번 변경은 운영 DB에 자동 적용되지 않는다.
2. 웹 배포에 `LEARNING_PUBLIC_MCP_ENABLED=true`, 정확한 `APP_ORIGIN=https://...`를 설정하고 배포한다.
   origin에는 경로/사용자정보/쿼리를 넣지 않는다. Preview별로 올바른 URL을 사용한다.
3. 워커에 `LEARNING_RESOURCE_MODE=mcp`, 동일한 `APP_ORIGIN`을 설정하고 새 Docker 이미지를 배포한다.
   워커는 SDK 의존성이 추가됐으므로 스크립트만 바꾼 옛 이미지로 실행하면 안 된다.
4. `node --env-file=.env.worker scripts/mcp/check.mjs`로 공개 도구만 확인한다. Gateway 추론/DB 쓰기는 없다.
5. 성인 테스트 계정·합성 답안으로 분석 → MCP 조회 → 교사 전달 → 학생 조회 → 철회 전체를 검증한다.
   학생이 제3자 사이트를 열기 전에도 교사 적합성 검토와 관련 이용 조건 확인이 필요하다.

`LEARNING_RESOURCE_MODE=local`은 같은 도구 코드를 네트워크 없이 실행하고 trace에 local로 기록한다.
`off`는 선택 자료 조회만 중지한다. mcp 모드 장애 때 몰래 local로 바꾸지 않으며, 빈 후보와
unavailable 상태를 기록하되 유효한 분석 결과는 보존한다. 수업별 교사의 직접 검토는 계속 가능하다.
로컬 HTTP 시험은 `LEARNING_ALLOW_LOCAL_MCP=true`와 loopback 주소가 모두 필요하다.

MCP 클라이언트 등록 예시 (`/integrations`에도 표시):

```json
{"mcpServers":{"learning-sos":{"url":"https://YOUR_DEPLOYMENT/api/mcp"}}}
```

공개 엔드포인트에는 Authorization이나 Cookie를 넣지 않는다. 클라이언트별 원격 MCP 지원/등록 방법은
각 제품의 최신 문서를 따른다. 특정 호스트의 앱 심사나 OAuth 커넥터 등록까지 완료한 것은 아니다.

## 보안·복구·승인 경계

MCP 요청 본문 16 KiB, 수신 시간 5초, 인스턴스당 동시 요청 16개 제한. Origin이 없으면 기계
클라이언트로 허용하고, 있으면 APP_ORIGIN과 정확히 일치해야 한다. Cookie/Authorization/forwarded host는
SDK에 넘기지 않는다. `maxSubscriptions=0`; 요청/응답 원문 로깅을 켜지 않는다.
공개 트래픽 전역 제한은 별도로 Vercel Firewall에서 설정해야 한다. 로컬 semaphore는 분산 rate limiter가 아니다.

워커의 MCP 요청은 APP_ORIGIN의 `/api/mcp` 한 곳만 허용한다. redirect/secondary URL,
쿠키·Gateway 키·Supabase 키 전달을 금지하고, 결과 64 KiB와 전체 조회 4초를 제한한다.
외부 결과는 목록 버전/ID/자료 버전/URL을 로컬 카탈로그와 대조한다. 표시 설명과 URL은 신뢰된
로컬/DB 카탈로그에서 다시 구성하고, MCP가 추가한 명령·설명은 사용하지 않는다.

자료 승인은 원자적 RPC, 현재 교사/학생 등록, 수업·문항 연결, 검토 체크, 표시된 답안 버전과
별도 resource_revision을 검사한다. 같은 request UUID 재전송은 한 번만 적용한다. 별도 리비전이므로
자료를 전달해도 AI 작업의 input_version을 바꾸거나 임대를 취소하지 않는다.
학생이 이유를 재제출하면 이전 input_version에 대한 전달은 현재 학생 화면에서 제외된다.
철회는 이후 앱 응답에서 링크를 제거하는 기능이지 이미 열어 본 공개 제3자 페이지의 접근권한을
없애는 기능은 아니다. 이력은 private 테이블에 남으므로 전체 보관/삭제 정책에 포함해야 한다.

카탈로그의 동일 버전 메타데이터는 DB trigger가 변경을 막는다. 긴급 중단은 운영자가 private
카탈로그의 enabled만 false로 변경한다. 새 답안에도 이전 승인에도 해당 링크를 반환하지 않는다.
공개 정적 MCP 디렉터리를 바꾸려면 소스 카탈로그와 새 additive migration을 같이 배포한다.
공개 MCP를 즉시 중단할 때는 LEARNING_PUBLIC_MCP_ENABLED=false로 재배포한다.

## 검증 방법과 한계

`pnpm test:mcp`는 공식 SDK의 구형/현재 프로토콜 상호운용, 도구/리소스/프롬프트, Origin, 크기/동시성,
자격증명 제거, URL 고정, 도구 결과 오염·버전 불일치, 연결 장애/취소, 데이터 최소화를 검사한다.
기존 connected CI는 실제 PostgreSQL에 001~007을 적용하고 권한·재전송·공유/철회·자료 중단·동시 요청을
검사한 뒤 Chromium에서 두 과목의 실제 HTTP MCP 조회, 전달/철회와 전체 학습 여정을 확인한다.
마지막에 DB를 별도로 조회해 resource_transport=mcp, resource_status=ok, 전달 1건/분석 이력 1건을 확인한다.

CI의 인증과 모델 응답은 합성 fixture다. MCP 서버/공식 클라이언트/HTTP/Next/DB/워커는 실제 코드다.
라이브 Gateway, 운영 Supabase Auth, 제3자 사이트 콘텐츠 본문, 운영 배포, 학습효과 시험은 별도다.
007의 롤백은 파괴적 테이블 삭제가 아니라 MCP OFF/worker off와 이전 웹 버전으로의 롤백을 우선한다.
private로 이동한 원래 learning_list는 새 wrapper에서 유지하며, 데이터 삭제 없이 이전 웹도 읽을 수 있다.

기술 계약:
https://github.com/vercel/mcp-handler/blob/main/README.md
https://modelcontextprotocol.io/specification/2026-07-28
https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
