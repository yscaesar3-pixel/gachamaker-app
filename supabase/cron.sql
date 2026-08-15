-- ============================================================
-- オンライン判定（ハートビート方式）＋ ルーム自動削除
-- pg_cron を使用。Supabaseプロジェクトで `create extension if not exists pg_cron;`
-- が有効になっていることを前提とする（ダッシュボードのDatabase > Extensionsから有効化）。
-- ============================================================

create extension if not exists pg_cron;

-- --------------------------------------------------------------
-- 1. オンライン状態の再計算
--    クライアントは15秒ごとにハートビートを送り last_seen_at を更新する。
--    40秒以上更新がなければオフライン扱いにする。
-- --------------------------------------------------------------
create or replace function gacha.recompute_online_status()
returns void
language plpgsql
as $$
begin
  -- 参加者ごとのオンラインフラグを更新
  update gacha.participants
  set online = false
  where online = true
    and kicked = false
    and left_at is null
    and last_seen_at < now() - interval '40 seconds';

  -- ルームごとの「オンライン参加者0人」時刻を更新
  update gacha.rooms r
  set zero_online_since = now()
  where r.status <> 'finished'
    and r.zero_online_since is null
    and not exists (
      select 1 from gacha.participants p
      where p.room_id = r.id
        and p.online = true
        and p.kicked = false
        and p.left_at is null
    );

  update gacha.rooms r
  set zero_online_since = null
  where r.zero_online_since is not null
    and exists (
      select 1 from gacha.participants p
      where p.room_id = r.id
        and p.online = true
        and p.kicked = false
        and p.left_at is null
    );
end;
$$;

-- --------------------------------------------------------------
-- 2. ルーム自動削除
--    - オンライン参加者0人が30分継続
--    - もしくはホストが明示的に終了してから30分経過
-- --------------------------------------------------------------
create or replace function gacha.delete_expired_rooms()
returns void
language plpgsql
as $$
begin
  delete from gacha.rooms
  where (
    status <> 'finished'
    and zero_online_since is not null
    and zero_online_since < now() - interval '30 minutes'
  ) or (
    status = 'finished'
    and finished_at is not null
    and finished_at < now() - interval '30 minutes'
  );
  -- participants / candidates / draws は on delete cascade により自動削除される
end;
$$;

-- --------------------------------------------------------------
-- 3. スケジュール登録
-- --------------------------------------------------------------
select cron.schedule(
  'gacha-recompute-online-status',
  '20 seconds',
  $$select gacha.recompute_online_status();$$
);

select cron.schedule(
  'gacha-delete-expired-rooms',
  '* * * * *', -- 1分ごと(標準cron形式)
  $$select gacha.delete_expired_rooms();$$
);

-- --------------------------------------------------------------
-- 4. 「みんなで一緒に開ける」の自動開封（10秒タイマーの保険）
-- --------------------------------------------------------------
select cron.schedule(
  'gacha-sweep-all-together-draws',
  '5 seconds',
  $$select gacha.sweep_all_together_draws();$$
);
