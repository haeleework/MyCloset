> 2026-10-08 · v26 배포 대상: Supabase 전체 수동 저장/복원, 날씨 필터와 색·편안함 추천, 사용자/개발자 화면. Vercel은 서울 지역 요청 처리 함수와 공용 날씨 임시 저장소를 사용합니다. 날씨는 화면 요청 시 최신 발표분을 수집하고 추천 계산은 저장된 예보만 읽습니다. 배포본의 Gemini 실제 호출과 배경 제거는 비활성입니다. 촬영용 로컬의 Gemini·날씨 활성 상태와 자료는 유지합니다. 정식 계정/기기 간 복구는 후속 범위입니다.

# 검증 결과와 재현

2026-10-08 · v26 Supabase 연결본.

- 새 npm ci 설치 후 앱339개 자동 검사 통과. npm test는 네트워크 차단 도구를 사용해 Gemini 실제 호출을 막습니다.
- PGlite 격리 DB 및 원격 SQL46개 검사 통과. 초기 구조부터 충돌 응답 보완까지5개 migration을 적용합니다. SQL 시험은 트랜잭션 롤백으로 정리합니다.
- 실제 Supabase API8개 검사 통과: 두 데모 사용자 자동 연결, 작은/7MB대 큰 합성 PNG와 배경 제거 이미지 저장, 해시가 같은 복원, 생활·분석·착용·피드백 보존, 반복 저장, 재접속 동일ID, stale revision409, 타인 행/사진·미인증 요청 거부, 추천API 성공과 Gemini 미호출. 각 묶음을 합쳐8개 결과로 기록합니다.
- 브라우저에서 회원가입 없이 전용 저장 공간 연결, 새로고침 후 유지 및 로그인 폼 미표시 확인.
- 정적 빌드31개 공개 파일만 생성. Vercel 빌드와 공개 주소의 날씨·추천·Supabase 저장 검증을 완료했습니다. Gemini와 배경 제거는 배포본에서 비활성입니다.

## 실행

앱 폴더에서 npm ci 후 npm test. DB는 npm --prefix database ci 후 npm --prefix database test.

실제 연결 검사는 database/check-cloud-live.mjs를 사용합니다. 실행 전 Gemini가 꺼진 전용 서버4336을 준비하고 CLOSET_LIVE_STORAGE_CHECK=1을 명시합니다. 이 검사는 Supabase에 합성 데이터만 생성하며 npm test에서는 실행되지 않습니다. 사진은 Storage API로 삭제하고 세션을 종료합니다. 생성된 시험ID는 live-test-identities.json에만 남기며, 해당ID만 관리자 도구로 정리합니다. 결과 JSON과 접속정보는 Git 제외입니다.

## 발견한 문제와 수정

SQLSTATE40001을 업무상 수정 충돌에 사용하면 현재 PostgREST가 재시도를 반복했습니다. PT409로 바꿔 실제 API가 즉시409를 반환하는 것을 확인했습니다. [Supabase 공식 문제 설명](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

Supabase 보안 검사는 데모 익명 사용자 소유권 정책13건과 비밀번호 유출 방지 미활성1건을 알립니다. [DATA](DATA.md)에 실제 정책과 의미를 기록했습니다.

## 아직 확인하지 않은 범위

사용자의 실제 개인 자료 전체 이전, 여러 휴대폰 기종의 사진 촬영/배경 제거, 사진별 Gemini 정확도, 이메일 계정 간 기기 동기화, Vercel 운영 배포는 이번 저장 검증에 포함하지 않습니다. 설치 시 onnxruntime-node postinstall이 승인되지 않았으므로 새 연결본의 배경 제거 런타임은 별도 확인이 필요합니다. 기존 촬영용 서버는 별도로 유지합니다.


## 2026-10-08 배포 검증

공개 주소 https://mycloset-fawn.vercel.app 에서 홈페이지/API200, 비밀 설정·서버 원본404 확인. 실제 서울 기상청 예보16~24도 응답과 추천200/Gemini0회 확인. Supabase 실서버 검사8묶음을 이 배포 주소 기준으로 재실행하여 작은 사진·7MB 사진·배경 이미지·전체 상태 저장/동일 해시 복원, 재접속, 재저장, 충돌409, 타인 차단을 확인했습니다. 시험 자료만 사용했으며 사용자의 개인 옷장은 이전하지 않았습니다. GitHub main 자동 배포 연결 완료.
