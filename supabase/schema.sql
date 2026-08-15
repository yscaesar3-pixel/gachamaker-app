-- ============================================================
-- みんなでガチャメーカー DBスキーマ
-- スキーマ名: gacha（Supabaseプロジェクト共有のため専用スキーマを使用）
-- ============================================================

create schema if not exists gacha;

-- 参加者IDなどはクライアントに露出するがランダムなUUIDなので推測不可
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- rooms: ルーム本体
-- ------------------------------------------------------------
create table gacha.rooms (
  id uuid primary key default gen_random_uuid(),

  -- 共有コード。ルームが存在する間だけユニーク（削除後は再利用可のため部分ユニーク制約）
  share_code text not null,

  name text not null default 'みんなでガチャメーカー',

  -- 候補をみんなに見せる？ true=見せる / false=抽選まで秘密
  show_candidates boolean not null default true,

  -- 誰が入れたか表示する？
  show_submitter boolean not null default false,

  -- 1人何個まで入れられる？ null = 無制限
  max_candidates_per_person integer,

  -- 開封方式: 'own_pace'（自分のタイミング） / 'all_together'（みんなで一緒）
  open_mode text not null default 'own_pace'
    check (open_mode in ('own_pace', 'all_together')),

  -- ルーム状態
  -- accepting: 候補受付中 / drawing: 抽選中 / awaiting_open: 開封待ち
  -- showing_result: 結果表示中 / finished: 終了済み
  status text not null default 'accepting'
    check (status in ('accepting', 'drawing', 'awaiting_open', 'showing_result', 'finished')),

  host_participant_id uuid, -- participants作成後にUPDATEで設定（循環参照回避）

  draw_count integer not null default 0,

  created_at timestamptz not null default now(),

  -- オンライン参加者が0人になった時刻。自動削除の30分カウント起点。
  zero_online_since timestamptz,

  finished_at timestamptz,

  -- 200件上限などをアプリ側でも計算するが、DB側にも候補数キャッシュを持たせておく
  candidate_count integer not null default 0
);

-- ルームが「生きている」間だけ共有コードをユニークにする
create unique index rooms_share_code_active_idx
  on gacha.rooms (share_code)
  where status <> 'finished';

create index rooms_zero_online_since_idx on gacha.rooms (zero_online_since)
  where status <> 'finished';

create index rooms_finished_at_idx on gacha.rooms (finished_at)
  where status = 'finished';

-- ------------------------------------------------------------
-- participants: 参加者
-- ------------------------------------------------------------
create table gacha.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references gacha.rooms(id) on delete cascade,

  nickname text not null,

  -- 端末に配布する秘密トークンのハッシュ（平文はDBに保存しない）
  token_hash text not null,

  is_host boolean not null default false,

  online boolean not null default true,
  kicked boolean not null default false,

  -- 正式退出したか（一時離脱と区別。仕様45/46）
  left_at timestamptz,

  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- 現在の抽選回における状態（みんなで開封の準備OK、開封方式Aでの開封済みフラグ）
  ready_current_draw boolean not null default false,
  opened_current_draw boolean not null default false,

  -- 抽選開始時点でオンラインだったか（みんなで開封の対象者判定に必要。仕様37）
  online_at_draw_start boolean not null default false
);

create index participants_room_id_idx on gacha.participants (room_id);
create unique index participants_token_hash_idx on gacha.participants (token_hash);

-- ------------------------------------------------------------
-- candidates: 候補（1投稿1レコード）
-- ------------------------------------------------------------
create table gacha.candidates (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references gacha.rooms(id) on delete cascade,
  participant_id uuid not null references gacha.participants(id) on delete cascade,

  text text not null,
  normalized_text text not null, -- 重複判定用（大文字小文字/全角半角/前後空白を正規化）

  created_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index candidates_room_id_idx on gacha.candidates (room_id) where deleted = false;
create index candidates_participant_id_idx on gacha.candidates (participant_id) where deleted = false;

-- 同一参加者による完全一致（正規化後）の重複を防ぐ（仕様14）
create unique index candidates_no_duplicate_per_participant
  on gacha.candidates (room_id, participant_id, normalized_text)
  where deleted = false;

-- ------------------------------------------------------------
-- draws: 抽選（1回ごと）
-- ------------------------------------------------------------
create table gacha.draws (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references gacha.rooms(id) on delete cascade,

  draw_number integer not null,

  started_at timestamptz not null default now(),

  -- 抽選開始時点でスナップショットした対象候補ID一覧
  candidate_ids uuid[] not null,

  winner_candidate_id uuid not null references gacha.candidates(id),

  open_mode text not null
    check (open_mode in ('own_pace', 'all_together')),

  awaiting_open_started_at timestamptz,

  ended_at timestamptz
);

create index draws_room_id_idx on gacha.draws (room_id);

-- ------------------------------------------------------------
-- RLS: すべて拒否。クライアントはanon keyで直接アクセスせず、
-- 必ずEdge Function（service role）経由でのみ読み書きする。
-- ------------------------------------------------------------
alter table gacha.rooms enable row level security;
alter table gacha.participants enable row level security;
alter table gacha.candidates enable row level security;
alter table gacha.draws enable row level security;
-- ポリシーを作成しない = anon/authenticatedからは一切アクセス不可（service_roleのみ操作可能）
