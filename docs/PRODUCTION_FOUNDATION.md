# 1차 안정화 기반

HTTP, 요청 멱등성, 폴링 세대 검사, 원문 인용·검색, 교과 독립 도메인 모듈을 추가한 초기 변경이다. 후속 DB·UI·모델 연결은 [LEARNING_RUNTIME.md](LEARNING_RUNTIME.md)를 따른다.

`pnpm test`는 외부 DB 기록이나 과금 모델 요청을 발생시키지 않는다. 실제 계정을 사용하는 기존 검증은 `test:integration`과 `test:classroom`으로 분리되어 있다. 재시도 식별자는 sessionStorage에 불투명 해시·UUID로 보관하고 답안/비밀번호 원문은 넣지 않는다. 네트워크 응답을 잃었을 때 같은 요청 ID로 재전송하지만, 이미 저장한 응답을 별도의 의도로 새로 제출하는 것과는 구분한다.
