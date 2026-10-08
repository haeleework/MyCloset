> 2026-10-08 · v26 배포 대상: Supabase 전체 수동 저장/복원, 날씨 필터와 색·편안함 추천, 사용자/개발자 화면. Vercel은 서울 지역 요청 처리 함수와 공용 날씨 임시 저장소를 사용합니다. 날씨는 화면 요청 시 최신 발표분을 수집하고 추천 계산은 저장된 예보만 읽습니다. 배포본의 Gemini 실제 호출과 배경 제거는 비활성입니다. 촬영용 로컬의 Gemini·날씨 활성 상태와 자료는 유지합니다. 정식 계정/기기 간 복구는 후속 범위입니다.

# Supabase 저장 구조와 실제 연결

2026-10-08 · v25. DB와 사진 저장 API 연결을 완료했습니다. 개인 자료는 자동 이전하지 않았습니다.

## 데이터 구조

- public 개인 표12개: wardrobe_garments, garment_details, garment_analyses, garment_media, user_preferences, daily_contexts, wear_history, wear_feedback, user_legacy_state, import_batches, import_items, weather_subscriptions.
- closet_private 운영 표6개: weather_cache, holiday_cache, job_runs, recommendation_cache, ai_budget_accounts, ai_calls. 일반 사용자는 접근하지 못합니다. 운영 서버 연결은 후속 작업입니다.
- closet-media 비공개 버킷: 파일당20MiB, JPEG/PNG/WebP/HEIC/HEIF. 원본과 배경 제거 사진은 각각 저장합니다.

## 소유권과 세션

데모도 내부적으로 고유 사용자ID를 발급합니다. 이메일/비밀번호를 입력하지 않으며, 본인 ID와 일치하는 행과 파일만 접근합니다. 인증받지 않은 요청과 다른 사용자 접근은 거부합니다. 데모 접속 정보는 현재 브라우저에 보관하고 필요한 때 갱신합니다. 브라우저 저장소 삭제/다른 기기에서는 같은 저장 공간에 자동 접속하지 않습니다.

## 전체 저장

closet_load_state는 본인 자료와 전체 revision(저장 변경 번호)을 읽습니다. closet_save_state는 예상 번호가 일치할 때 옷/분석/생활/일정/착용/피드백을 한 DB 트랜잭션으로 저장합니다. 충돌은 PT409→HTTP409로 즉시 반환합니다. 40001은 현재 PostgREST의 무한 재시도 문제 때문에 업무 충돌에 사용하지 않습니다.

사진 경로는 사용자ID/옷ID/SHA256지문/original 또는 cutout입니다. 사진은 DB JSON에 넣지 않고 Storage에 직접 전송합니다. 6MiB를 넘으면 TUS로 분할 전송합니다. closet_finish_media는 실제 파일의 크기·형식이 일치할 때 ready로 표시합니다. 전체 저장 성공은 필요한 모든 사진의 완료 뒤에만 표시합니다. 복원할 때 원본 바이트의 SHA256까지 재검증합니다. 미완료 사진이 있으면 부분 복원을 적용하지 않습니다.

## 변경 파일과 검사

[변경 파일 폴더](../database/supabase/migrations/)의 초기 구조, 권한 보완, 전체 저장, 데모 소유권, 충돌 응답 보완 순서로5개를 적용합니다. 기존 프로젝트에 중복 실행하지 않습니다. 로컬/원격 SQL46개와 실제API8개(큰 사진 포함) 통과. 시험 파일은 Storage API로 삭제하고 시험 계정은 세션 종료 뒤 해당ID만 정리했습니다.

익명 데모 소유권을 허용하므로 Supabase 검사에는 Anonymous Access Policies13건이 표시됩니다. 이는 로그인하지 않은 임의 요청을 허용한다는 뜻이 아니며 실제 두ID 격리를 확인했습니다. 비밀번호 유출 방지 미활성 경고1건은 비밀번호 계정을 지원하기 전에 검토합니다. [정책 검사 안내](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [비밀번호 보호](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

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
| colorDescription/pattern/surface/silhouette/lengthDescription/url | garment_details.display_metadata | 화면/관찰 상세 보존. 추천 필드와 분리 |
| styleGroup/styleTaxonomy | garment_details.display_metadata | 스타일 원문 그룹과 분류 버전 보존. 전체 저장에 포함 |
| vision.analysis·분석 모델/시각/메타데이터 | garment_analyses | 등록 당시 분석 원본을 사용자별 보관. 일반 운영 로그에 넣지 않음 |
| vision.userReview, 수정/빈값 기록 | garment_details.review_state | confirmed_in_app은 등록 확인이지 AI 추정의 실측 확정이 아님 |
| capture | garment_details.capture_metadata | 선별한 촬영 메타데이터만. GPS 필드는 제외하지만 원본 이미지 내부 EXIF 제거 기능은 아님 |
| photo/cutout의 Blob | private Storage + garment_media | JSON에 넣지 않고 실제 파일로 분리 |
| 알 수 없는 옛 필드 | 이전 묶음 원본과 검토 목록 | 버리지 않음. 활성 추천 입력에 무조건 전달하지 않음 |


전체 저장은 옷500개, 착용/피드백 각각5000개, JSON3.5MB를 한도로 확인합니다. 임의의 옛 필드를 모두 옮기는 범용 이전기는 아닙니다. 상세 한계는 [DATA-IMPORT](DATA-IMPORT.md)를 따릅니다.
