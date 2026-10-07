# 외부 구성 요소와 자료 출처

이 저장소는 아래 도구와 참고 자료를 사용합니다. 모델 가중치, 원본 학습 사진, 개인 사진을 저장소에 복제하지 않습니다. 설치된 패키지의 라이선스 원문과 상세 표시는 각 패키지에 유지됩니다.

| 항목 | 사용 범위와 출처 |
| --- | --- |
| IMG.LY background-removal-node 1.4.5 | PC 배경 제거. [공식 문서](https://github.com/imgly/background-removal-js/blob/main/packages/node/README.md)는 AGPL 사용 조건과 별도 라이선스 문의를 안내합니다. 설치 패키지의 LICENSE.md와 ThirdPartyLicenses.json도 참고합니다. |
| exifr 7.1.3 | 사진에 포함된 촬영 정보 읽기. [프로젝트](https://github.com/MikeKovarik/exifr)와 설치 패키지의 라이선스 참고. |
| sharp / ONNX Runtime | 이미지 전처리와 모델 실행. 설치 패키지별 저작권·라이선스를 따릅니다. |
| AI Hub K-Fashion | 23개 스타일 명칭을 참고한 분류표. [자료 소개](https://www.aihub.or.kr/aihubdata/data/view.do?currMenu=115&dataSetSn=51&topMenu=100). 원본 이미지·학습 데이터는 포함하지 않습니다. 다섯 느낌과의 연결은 이 앱 자체의 예시 규칙이며 공식 상위 분류가 아닙니다. |
| 기상청 단기예보 | [공공데이터포털](https://www.data.go.kr/data/15084084/openapi.do). 지역 자료는 제공받은 2026-07-01 기준 격자표에서 추출한 이름·격자·식별자이며 출처 파일명과 해시를 region-data.json에 기록했습니다. 행정구역의 실시간 최신성을 보장하지 않습니다. |
| 한국천문연구원 특일 정보 | 공휴일 갱신. 원본 요청 주소는 holiday-store.mjs의 holidaySourceUrl 참고. |

프로젝트 전체에 새로운 재사용 라이선스를 임의로 지정하지 않았습니다. 의존 패키지 및 자료의 사용 조건은 그대로 적용됩니다.
