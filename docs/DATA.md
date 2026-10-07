# Supabase DB 적용 결과와 연결할 때의 기준

2026-10-08 · 현재 연결된 Supabase 프로젝트 기준.

현재 저장 설계를 실제 DB에 적용했습니다. **DB 구조 생성은 완료됐고, 개인 옷장 이전과 앱의 저장 모드 전환은 아직 하지 않았습니다.** 현재 로컬 시연은 그대로입니다.

## 생성한 구조

| 위치 | 표 |
| --- | --- |
| public 개인 데이터 12개 | wardrobe_garments, garment_details, garment_analyses, garment_media, user_preferences, daily_contexts, wear_history, wear_feedback, user_legacy_state, import_batches, import_items, weather_subscriptions |
| closet_private 운영 데이터 6개 | weather_cache, holiday_cache, job_runs, recommendation_cache, ai_budget_accounts, ai_calls |
| Storage | closet-media 비공개 버킷, 최대 20MiB, JPEG/PNG/WebP/HEIC/HEIF |

개인 표는 사용자 ID를 기준으로 RLS(행마다 주인을 확인하는 접근 제한)를 적용했습니다. 익명 계정과 다른 계정의 데이터 접근을 막습니다. 관련 옷/기록/이전 묶음도 사용자 ID를 포함한 참조로 연결합니다.

운영 표는 일반 사용자에게 스키마 접근을 주지 않고 서버용 권한에만 허용했습니다. 개발자 모드 토글은 이 권한을 부여하지 않습니다. 사진 경로는 사용자ID/옷ID/파일ID/파일명 구조입니다. 사진 파일은 아직 전송하지 않았습니다.

## 수정과 비용 처리

모든 개인 표는 DB에서 revision과 시각을 관리합니다. public.closet_update_garment는 예상 revision이 맞을 때만 수정합니다. 기존 앱의 일괄 upsert는 아직 이 충돌 확인 함수를 사용하지 않으므로 앱 연결 작업이 필요합니다.

public.closet_reserve_ai와 closet_settle_ai는 서버만 실행합니다. 공동 예산 행을 잠그고 예약/정산하며, 같은 요청의 중복 예약·중복 차감을 막습니다. 결과가 불확실한 호출은 예약 상한을 보수적으로 반영합니다. 아직 비용 원장을 생성하거나 기존 누적액을 이전하지 않았으므로 0원으로 초기화된 새 예산이 아닙니다.

공용 날씨/예산 표에 접근하는 배포 서버 경로, 사진 직접 업로드, 생활/수정 이력 동기화, 예약 실행은 후속 앱 개발입니다. DB 생성만으로 기존 브라우저 자료가 자동 이전되지는 않습니다.

## 변경 파일과 재현

- [첫 구조](../database/supabase/migrations/20261007222443_closet_initial_storage.sql)
- [권한 보완](../database/supabase/migrations/20261007222604_closet_policy_hardening.sql)
- [검사 SQL](../database/verification.sql)

Supabase CLI 2.120.0의 migration new로 생성한 파일을 사용했습니다. MCP 적용 시 서버가 기록한 버전 번호에 로컬 파일명을 맞췄습니다. 동일 프로젝트에는 이미 적용된 SQL을 다시 수동 실행하지 않습니다. 새 개발 환경은 두 파일을 순서대로 적용합니다.

로컬 재현 도구는 고정 버전 PGlite 0.5.8이며 package-lock.json을 포함합니다. database 폴더에서 npm ci 후 npm test로 격리된 DB 검사를 실행할 수 있습니다. 실제 Gemini를 호출하지 않습니다.

## 검증과 한계

로컬과 원격 PostgreSQL에서 최종 32개 SQL 검사를 통과했습니다. 12개 개인 표의 본인 생성/타인 조회 제한, 타인 수정/삭제/삽입 차단, 소유자 변경 거부, null/false/빈값 보존, 이전 revision 거부, 사진 메타데이터 접근, 예산 중복·한도·불확실 정산을 포함합니다.

SQL에서 시험용 사용자 역할과 인증 주장을 설정한 검사입니다. 실제 로그인 화면이나 실제 파일 업로드 API를 테스트한 것은 아닙니다. 원격 Storage가 직접 SQL 삭제를 차단하는 보호 장치를 확인했으며 이를 우회하지 않았습니다. 실제 파일 삭제는 Storage API로 처리해야 합니다.

검사 전체를 트랜잭션에서 되돌려 최종 auth.users/옷/Storage 객체/예산 행은 모두 0개입니다. 보안 점검 지적 0건, 성능 점검 경고 0건입니다. 데이터가 아직 없어 ‘사용 이력 없는 색인’ 정보 9건은 유지합니다. [미사용 색인 안내](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

기존 플랫폼의 rls_auto_enable 이벤트 함수는 본문/자동 RLS 동작을 보존하고 일반 사용자의 직접 실행 권한만 제거했습니다. 소유권 정책의 인증값 조회와 운영 표의 서버 전용 정책도 추가 점검 결과에 맞춰 명시했습니다.

## 다음 연결 순서

앱 사용자 로그인→원격 저장/사진 API 연결→가상 자료로 실제 두 계정 시험→원래 브라우저 개인 백업→이전 미리보기와 검증→클라우드 저장 전환 순서입니다. GitHub/Vercel 배포는 별도이며 아직 실행하지 않았습니다.

## 기존 옷 필드 대응

| 기존 필드 | 배포용 저장 위치 | 정리 원칙 |
| --- | --- | --- |
| id | wardrobe_garments.id | UUID처럼 보여도 text 유지. 이름으로 다시 생성하지 않음 |
| name/category/color/fit/officialSize/style | attributes 동일 이름 | 원문 보존. category는 top/bottom/dress/shoe/outer |
| warmth/formal/comfort/available | attributes 동일 이름 | 숫자 0·false·null을 구분. warmth 0/0.5/1/1.5/2, 모름 null |
| officialColor/itemType/itemTypeSource | attributes 동일 이름 | 블랙 팬츠를 자동 청바지로 바꾸지 않음 |
| material/materialConfirmed/length | attributes 동일 이름 | 확인 안 된 소재를 확정으로 승격하지 않음 |
| thickness/thicknessSource/thicknessEvidence | attributes 동일 이름 | 5단계 값과 AI 추정/사용자/모름 출처, 근거 함께 유지 |
| insulationVisual/insulationSource/insulationEvidence | attributes 동일 이름 | 기모/안감/충전 구조 단서와 실제 보온을 구분 |
| colorFamily/colorLightness/colorChroma/colorHue | attributes 동일 이름 | 값 없음은 null. 현재 HSL 의미를 보존하고 새 색 공간으로 묵시 변환 금지 |
| styleTags/moods/garmentKind/garmentKindConfirmed | attributes 동일 이름 | 허용된 문자열 배열·확인값 유지 |
| colorDescription/pattern/surface/silhouette/lengthDescription/url | garment_details.display_metadata | 현재 어댑터에서 누락되는 화면/관찰 상세. 추천 필드와 혼합하지 않음 |
| styleGroup/styleTaxonomy | garment_details.display_metadata | 스타일 원문 그룹과 분류 버전 보존. 현재 속성 업로드만으로는 함께 옮겨지지 않음 |
| vision.analysis·분석 모델/시각/메타데이터 | garment_analyses | 등록 당시 분석 원본을 사용자별 보관. 일반 운영 로그에 넣지 않음 |
| vision.userReview, 수정/빈값 기록 | garment_details.review_state | confirmed_in_app은 등록 확인이지 AI 추정의 실측 확정이 아님 |
| capture | garment_details.capture_metadata | 이미 사용하던 촬영 시각만. GPS/불필요 EXIF 제외 |
| photo/cutout의 Blob | private Storage + garment_media | JSON에 넣지 않고 실제 파일로 분리 |
| 알 수 없는 옛 필드 | 이전 묶음 원본과 검토 목록 | 버리지 않음. 활성 추천 입력에 무조건 전달하지 않음 |

현재 업로드 어댑터는 위 표의 attributes 행만 지원합니다. 나머지를 옮기려면 별도 표와 API가 필요합니다. 문자열/배열 길이 제한을 초과하면 조용히 누락하지 말고 이전 검증에서 해당 옷과 필드를 알려야 합니다.


전체 데이터 이전 순서는 [DATA-IMPORT](DATA-IMPORT.md)을 따릅니다. 현재 메타데이터 어댑터는 최대 500개를 지원하며 전체 사진·생활 정보 동기화를 대체하지 않습니다.
