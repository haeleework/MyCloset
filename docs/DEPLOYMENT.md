# 실행과 배포

2026-10-08 · v27: Vercel 옷 추가에서 Gemini 사진 분석과 선택적 배경 제거를 연결했습니다. 원본은 보관하고 처리용 사본은 긴 변 1,600px·2.5MB 이하로 변환합니다. 로컬·배포본의 사진/텍스트 호출은 Supabase의 같은 5,000원 추정 예산을 사용합니다. Supabase 전체 수동 저장/복원, 날씨·추천 정책과 사용자/개발자 화면은 유지합니다. 정식 계정·기기 간 복구는 후속 범위입니다.

## Vercel 설정

- 프로젝트: haelee/mycloset (무료 Hobby), Node.js 24, 함수 실행 지역 icn1(서울).
- GitHub: https://github.com/haeleework/MyCloset, 운영 브랜치 main.
- 빌드: npm run build; 설치: npm ci --ignore-scripts; 정적 결과: dist.
- api/app.mjs는 HTTP 요청만 처리하고 로컬 listen/상시 타이머를 실행하지 않습니다.
- SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, KMA_SERVICE_KEY, KMA_PROVIDER, 선택 KASI_SERVICE_KEY를 Vercel production/preview 설정에 넣습니다. 비밀 인증값은 sensitive로 저장합니다. .env/.vercel/개인 자료는 GitHub에서 제외됩니다.
- 앱 주소는 Vercel 시스템 설정의 배포/운영/브랜치 주소만 허용합니다. 커스텀 도메인을 추가하면 CLOSET_PUBLIC_ORIGINS에 https://도메인 형식으로 명시해야 합니다. POST는 같은 HTTPS 출처만 허용합니다.
- Supabase 연결에는 공개 연결 키와 사용자 토큰만 사용합니다. 관리자 키를 배포하지 않습니다.

## 동작 범위와 제한

1. 로그인 화면 없이 브라우저별 데모 ID로 Supabase에 연결합니다. 사진은 비공개 버킷에 브라우저에서 직접 올리므로 Vercel 요청 크기 제한을 거치지 않습니다. 전체 저장/복원은 사용자가 확인한 후 실행합니다.
2. 날씨 GET 요청에서 최신 발표분을 수집한 뒤 결과를 반환합니다. 임시 자료는 Vercel Runtime Cache에 6시간 보관하고 새로운 서버에서도 재사용합니다. 추천 요청 자체는 수집하지 않습니다. 상시 예약 수집은 로컬에서만 실행합니다. 동시 서버 첫 요청에는 중복 수집 가능성이 있습니다. 캐시 장애/예보 부족을 실제 날씨처럼 만들지 않습니다.
3. 공휴일은 공유 캐시에 보관하며 공급자 실패 시 기본 자료와 실패 상태를 함께 반환합니다.
4. Gemini 활성 조건은 CLOSET_ENABLE_GEMINI=1, GEMINI_API_KEY, CLOSET_BUDGET_API_URL, CLOSET_BUDGET_API_TOKEN입니다. 키와 토큰은 Vercel Secret으로 설정합니다. 로컬 4335와 같은 Supabase 비용 계정을 사용하며, 기록 조회/예약 실패 시 실제 호출을 차단합니다. 기존 사용액을 이전했고 한도는 초기화하지 않았습니다.
5. 배경 제거는 Vercel의 Linux CPU에서 IMG.LY small 모델을 실행합니다. 모델 파일을 함수에 포함하며 별도 유료 배경 제거 API를 호출하지 않습니다. 빌드 시 불필요한 medium 모델을 제외합니다. 함수 최대120초, 화면 대기115초. 배경 제거 결과1024px PNG와 원본을 별도 보관합니다.
6. 데모 ID는 해당 브라우저 접속 정보에 연결되며 다른 기기에서 자동 복구되지 않습니다. 정식 다중 사용자 서비스 전 계정 복구와 가입 남용 방지를 추가 검토해야 합니다.

## 로컬 보존

4335 촬영본과 4336 저장 검증본은 변경하지 않습니다. npm start는 기존 로컬 서버 실행 방식이고 CLOSET_ENABLE_GEMINI=1, CLOSET_TEST_MODE!=1, 기존 CLOSET_BUDGET_DIR 지정 시에만 로컬 실제 호출을 허용합니다.

## 검증

앱 339개 오프라인 검사 통과(기존336개+배포 보안/캐시3개). 기존 실제 Supabase 8묶음 검증과 SQL46개 결과를 유지합니다. 배포 URL과 실서버 검증 결과는 배포 완료 후 이 문서에 기록합니다.


## 2026-10-08 배포 검증

공개 주소 https://mycloset-fawn.vercel.app 에서 홈페이지/API200, 비밀 설정·서버 원본404 확인. 실제 서울 기상청 예보16~24도 응답과 추천200/Gemini0회 확인. Supabase 실서버 검사8묶음을 이 배포 주소 기준으로 재실행하여 작은 사진·7MB 사진·배경 이미지·전체 상태 저장/동일 해시 복원, 재접속, 재저장, 충돌409, 타인 차단을 확인했습니다. 시험 자료만 사용했으며 사용자의 개인 옷장은 이전하지 않았습니다. GitHub main 자동 배포 연결 완료.

## v27 공동 비용 연결과 검증

`database/budget-edge-entry.ts`와 `budget-bridge.mjs`, `budget-cost.mjs`를 Supabase Edge Function `closet-budget`으로 배포합니다. 배포 때 `__SERVER_TOKEN_SHA256__`에 충분히 무작위인 서버 전용 토큰의 SHA-256을 대입합니다. 실제 토큰은 로컬 비공개 설정과 Vercel Secret에만 둡니다. 기본 JWT 검사는 끄되 함수 본문의 서버 토큰 인증을 반드시 유지합니다. 허용 작업은 snapshot/reserve/finish 세 가지이며, 관리자 DB 키는 Supabase 함수 내부의 기본 설정만 사용합니다. 브라우저에는 전달하지 않습니다.

새 환경에서는 기존 호출을 먼저 중지하고 사용액·미결 예약을 보수적으로 이전한 뒤 같은 비용 계정을 연결합니다. 비어 있는 계정에만 처음 기록하며 재배포 때 계정이나 예산을 초기화하지 않습니다. 사용량 없는 응답/중단은 전체 예약을 유지합니다. 예약·정산 함수는 행 잠금과 요청 ID로 동시 초과 사용·중복 정산을 방지합니다.

시험 배포에서 합성 티셔츠 사진의 Gemini 응답200(약8.7초)과 배경 제거200(첫 처리 약16초, 투명1024×1024 PNG)을 확인했습니다. 공개 배포 확인은 작업일지 및 최종 안내를 따릅니다.
