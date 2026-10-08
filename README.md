> 2026-10-08 · v26 배포 대상: Supabase 전체 수동 저장/복원, 날씨 필터와 색·편안함 추천, 사용자/개발자 화면. Vercel은 서울 지역 요청 처리 함수와 공용 날씨 임시 저장소를 사용합니다. 날씨는 화면 요청 시 최신 발표분을 수집하고 추천 계산은 저장된 예보만 읽습니다. 배포본의 Gemini 실제 호출과 배경 제거는 비활성입니다. 촬영용 로컬의 Gemini·날씨 활성 상태와 자료는 유지합니다. 정식 계정/기기 간 복구는 후속 범위입니다.

# 오늘의 옷장 · ClosetAgent

보유한 옷으로 날씨와 일정에 맞는 코디를 추천하는 앱입니다. 현재 소스 버전은 **0.26.0**입니다.

## 현재 상태

- 날씨·복장 필수조건, 색 점수, Top 5 추천, 편안함 우선 조정, 사용자/개발자 화면이 구현됐습니다.
- Supabase DB 18개 표와 비공개 사진 버킷, 소유권 정책, 공동 예산 함수가 생성됐습니다. 사진·분석 결과·생활·기록의 수동 전체 저장/복원과 실제 API 검증을 완료했습니다. 개인 자료 이전은 아직 하지 않았습니다.
- 이 저장소는 최신 소스와 필수 문서를 정리한 버전입니다. **Vercel 요청 처리와 정적 화면 빌드를 분리했습니다.** 설정 및 배포 확인은 [배포 문서](docs/DEPLOYMENT.md)에 구분했습니다.

## 로컬 실행

Node.js 24를 설치한 환경에서 이 폴더를 터미널로 열고 다음 명령을 실행합니다.

```sh
npm ci
npm start
```

브라우저에서 http://127.0.0.1:4331 을 엽니다. 이미 같은 포트로 실행 중인 앱이 있다면 그 앱을 유지하고 PORT를 다른 번호로 설정합니다. 주소·포트가 바뀌면 기존 브라우저 옷장이 자동으로 옮겨지지 않습니다. 처음에는 화면의 ‘12개 옷장으로 체험하기’를 사용할 수 있습니다.

기본 저장 방식은 local, Gemini는 기본 비활성입니다. 설정이 필요하면 이 폴더에 직접 .env를 만들고 아래 이름에 해당하는 값을 넣습니다. .env는 GitHub에 올리지 않습니다. 설정 변경 후 서버를 다시 시작합니다.

| 설정 | 용도 |
| --- | --- |
| PORT | 기본 4331, 다른 로컬 서버와 겹치지 않는 번호 |
| CLOSET_TEST_MODE | 1이면 Gemini와 날씨·공휴일 배경 수집 중지 |
| KMA_SERVICE_KEY / KMA_PROVIDER | 기상청 인증값 / 기본 data |
| KASI_SERVICE_KEY | 공휴일 인증값 |
| CLOSET_STORAGE_MODE | 기본 local; 사진 포함 클라우드 저장을 사용할 때 supabase |
| CLOSET_AUTH_MODE | demo이면 이메일/비밀번호 없는 전용 저장 공간 자동 연결 |
| CLOSET_RECOMMENDATION_MODE | local이면 클라우드 저장 전에도 현재 브라우저 옷장으로 추천 |
| SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY | 프로젝트 주소 / 공개용 키. 관리자 키는 넣지 않음 |
| CLOSET_ENABLE_OBSERVATIONS | 1이면 관측 온습도 연결 활성화 |
| CLOSET_ENABLE_GEMINI / GEMINI_API_KEY | 유료 호출을 명시적으로 활성화할 때 1 / 비밀 인증값 |
| CLOSET_BUDGET_DIR | Gemini를 켤 때 필수. 기존 비용 기록 폴더를 연결하고 누적 금액을 초기화하지 않음 |

CLOSET_TEST_MODE는 모든 외부 통신을 막는 설정이 아닙니다. 자동 검사에서는 별도의 네트워크 차단 도구를 사용합니다. 프로그램 설정값을 외부로 공개하지 마세요.

## 발표자료

- [신혜리 · MyCloset 발표자료 다운로드(PowerPoint)](docs/presentations/MyCloset_발표자료_신혜리.pptx?raw=true)

다운로드한 파일을 PowerPoint에서 열어주세요. 사용자 제공 원본 자료입니다.

## 문서

- [제품 요구사항](docs/PRD.md) · [기능 명세](docs/SPEC.md)
- [추천 규칙](docs/RECOMMENDATION-RULES.md) · [사용 방법](docs/USER-GUIDE.md)
- [DB 구조와 필드 대응](docs/DATA.md) · [기존 옷장 이전 계획](docs/DATA-IMPORT.md)
- [Vercel 배포 전환](docs/DEPLOYMENT.md) · [검증 방법과 범위](docs/TESTING.md)
- [사용한 외부 구성 요소](THIRD_PARTY.md)

## GitHub에 올리는 범위

**이 폴더의 내용만 저장소 최상위로 사용합니다.** 바깥 워크샵 폴더 전체를 업로드하지 않습니다. 구버전·작업일지·조사 자료·저장 지점·개인 사진·실제 계정 자료·비밀 설정은 포함하지 않았습니다. fixtures의 작은 사진은 EXIF 검사에 쓰는 합성 회색 이미지입니다.

.gitignore는 비밀 설정, 설치 패키지, 캐시, 로그, 개인 백업, 검사 결과를 제외합니다. 웹사이트에서 파일을 직접 끌어 올리는 방식은 이 규칙을 자동으로 적용하지 않을 수 있으므로 Git이 표시하는 변경 목록을 확인하고 업로드합니다. 제외 파일을 강제로 추가하지 않습니다. GitHub 저장소는 [haeleework/MyCloset](https://github.com/haeleework/MyCloset)입니다. Vercel 프로젝트 haelee/mycloset과 main 자동 배포 연결을 완료했습니다. 공개 주소는 https://mycloset-fawn.vercel.app 입니다.
