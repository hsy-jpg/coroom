# DB.md — coroom Supabase 스키마

## 연결 정보
- Project URL: `https://mtdjditsurrhlxistnqk.supabase.co`
- Publishable(anon) key: `sb_publishable_YLkvebFero_LJZ-9JzNkCw_aZC39Tqq`
- supabase-js는 CDN(ESM)으로 로드해서 사용 (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm`)

> 주의: 이 Supabase 프로젝트(`test-project`)는 coroom 전용이 아니라 다른 앱(pages/profiles/projects/cards 등)과 공유 중이다. 그래서 coroom 테이블은 이름이 겹치지 않게 분리되어 있다. **`profiles`가 아니라 `coroom_profiles`를 사용해야 한다.**

## 테이블

### `public.meeting_rooms`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | smallint (PK) | 회의실번호 1~6 |
| name | text | 회의실명 |
| capacity | int | 수용인원 |
| floor | text | 층 |
| equipment | text | 보유장비 |
| note | text (nullable) | 비고 |
| created_at | timestamptz | 생성일시 |

- 이미 1~6번 회의실 데이터 seed 완료 (PRD.md 3장 표 참고)

### `public.coroom_profiles`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK, = auth.users.id) | 사용자 ID |
| name | text | 이름 |
| department | text (nullable) | 부서 |
| role | text | `user`(기본) / `admin` |
| created_at | timestamptz | 생성일시 |

- `auth.users`에 신규 유저가 생기면 트리거(`coroom_handle_new_user`)가 자동으로 row를 만든다.
- `supabase.auth.signUp()` 호출 시 `options.data`에 `{ name, department }`를 담아 보내면 트리거가 `raw_user_meta_data->>'name'`, `raw_user_meta_data->>'department'`를 읽어 채운다.

### `public.reservations`
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid (PK) | |
| reservation_code | text (unique) | 서버가 자동 생성 (insert 시 넣지 않아도 됨) |
| room_id | smallint (FK → meeting_rooms) | |
| user_id | uuid (FK → coroom_profiles) | insert 시 반드시 `auth.uid()`와 동일해야 RLS 통과 |
| title | text | 회의 제목 |
| reservation_date | date | |
| start_time | time | |
| end_time | time | `end_time > start_time` 체크 제약 있음 |
| status | text | `confirmed`(기본) / `cancelled` |
| created_at | timestamptz | |

- **더블부킹은 DB의 EXCLUDE 제약으로 원천 차단**: 같은 `room_id` + 겹치는 시간대 + `status='confirmed'`인 예약을 insert하면 Postgres 에러(코드 `23P01`, exclusion violation)가 난다. 프론트는 이 에러를 캐치해서 "이미 예약된 시간입니다" 같은 안내 후 화면을 새로고침해야 한다.

## RLS 정책
- `meeting_rooms`: 전체 select 가능. insert/update/delete는 `coroom_profiles.role='admin'`만 가능.
- `coroom_profiles`: 전체 select 가능(대시보드에 예약자/부서 표시용). update는 본인 또는 admin만.
- `reservations`: 전체 select 가능(대시보드 전체 현황용). insert는 `user_id = auth.uid()`인 경우만. update(취소 포함)는 본인 또는 admin만.

## Realtime
- `reservations` 테이블 변경을 구독해서 대시보드/내 예약 화면을 자동 갱신하는 것을 권장.

## Auth
- 이메일+비밀번호 방식 (`supabase.auth.signUp` / `signInWithPassword` / `signOut`).
- 이 프로젝트는 이메일 확인 없이 가입 즉시 로그인되도록 설정되어 있음.
