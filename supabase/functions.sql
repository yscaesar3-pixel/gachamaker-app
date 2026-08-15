-- 候補数キャッシュ(rooms.candidate_count)を原子的に増減する。
-- 同時投稿・同時削除でもレースコンディションが起きないよう、行ロックを使う。
create or replace function gacha.increment_candidate_count(p_room_id uuid, p_delta integer)
returns void
language plpgsql
as $$
begin
  update gacha.rooms
  set candidate_count = greatest(0, candidate_count + p_delta)
  where id = p_room_id;
end;
$$;

-- ------------------------------------------------------------
-- 抽選開始（サーバー側で確定・抽選まで一括実行。仕様28/29/59）
-- 行ロックにより、連打しても最初の1回しか有効な抽選にならない。
-- ------------------------------------------------------------
create or replace function gacha.start_draw(p_room_id uuid)
returns gacha.draws
language plpgsql
as $$
declare
  v_room gacha.rooms%rowtype;
  v_candidate_ids uuid[];
  v_winner_id uuid;
  v_draw gacha.draws%rowtype;
  v_animation_ms constant integer := 6000;
  v_ready_seconds constant integer := 10;
begin
  -- 行ロックで同時リクエストを直列化する
  select * into v_room from gacha.rooms where id = p_room_id for update;

  if not found then
    raise exception 'room_not_found';
  end if;
  if v_room.status <> 'accepting' then
    raise exception 'not_accepting';
  end if;

  select array_agg(id) into v_candidate_ids
  from gacha.candidates
  where room_id = p_room_id and deleted = false;

  if v_candidate_ids is null or array_length(v_candidate_ids, 1) < 2 then
    raise exception 'not_enough_candidates';
  end if;

  -- 1投稿=1カプセルの均等抽選(仕様15/29)。crypto品質は不要な用途のためrandom()で十分。
  select id into v_winner_id
  from gacha.candidates
  where id = any(v_candidate_ids)
  order by random()
  limit 1;

  insert into gacha.draws (
    room_id, draw_number, started_at, candidate_ids, winner_candidate_id,
    open_mode, awaiting_open_started_at
  ) values (
    p_room_id,
    v_room.draw_count + 1,
    now(),
    v_candidate_ids,
    v_winner_id,
    v_room.open_mode,
    now() + make_interval(secs => v_animation_ms / 1000.0)
  )
  returning * into v_draw;

  update gacha.rooms
  set status = 'awaiting_open', draw_count = v_room.draw_count + 1
  where id = p_room_id;

  -- 参加者の抽選単位フラグをリセットし、開始時点のオンライン状況を記録(仕様37/52)
  update gacha.participants
  set ready_current_draw = false,
      opened_current_draw = false,
      online_at_draw_start = online
  where room_id = p_room_id
    and kicked = false
    and left_at is null;

  return v_draw;
end;
$$;

-- ------------------------------------------------------------
-- 「みんなで一緒に開ける」の自動開封チェック
-- 準備OK全員 or 開封待ち開始から10秒経過 で開封する。
-- 開封が確定したら Realtime Broadcast(from Database) で draw_opened を配信する。
-- pg_cronからの定期チェックでも、mark-ready呼び出し時でも同じ関数を使うため、
-- どちらの経路で開封しても必ず配信される。
-- ------------------------------------------------------------
create or replace function gacha.try_auto_open_draw(p_room_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_room gacha.rooms%rowtype;
  v_draw gacha.draws%rowtype;
  v_target_count integer;
  v_ready_count integer;
  v_should_open boolean := false;
  v_winner_text text;
  v_winner_participant_id uuid;
  v_submitter_nickname text;
begin
  select * into v_room from gacha.rooms where id = p_room_id for update;
  if not found or v_room.status <> 'awaiting_open' or v_room.open_mode <> 'all_together' then
    return false;
  end if;

  select * into v_draw from gacha.draws
  where room_id = p_room_id order by draw_number desc limit 1;
  if not found or v_draw.ended_at is not null then
    return false;
  end if;

  select count(*) into v_target_count
  from gacha.participants
  where room_id = p_room_id and kicked = false and left_at is null
    and online_at_draw_start = true;

  select count(*) into v_ready_count
  from gacha.participants
  where room_id = p_room_id and kicked = false and left_at is null
    and online_at_draw_start = true and ready_current_draw = true;

  if v_target_count > 0 and v_ready_count >= v_target_count then
    v_should_open := true;
  elsif now() >= v_draw.awaiting_open_started_at + interval '10 seconds' then
    v_should_open := true;
  end if;

  if v_should_open then
    update gacha.rooms set status = 'showing_result' where id = p_room_id;
    update gacha.draws set ended_at = now() where id = v_draw.id;

    select text, participant_id into v_winner_text, v_winner_participant_id
    from gacha.candidates where id = v_draw.winner_candidate_id;

    v_submitter_nickname := null;
    if v_room.show_submitter then
      select nickname into v_submitter_nickname
      from gacha.participants where id = v_winner_participant_id;
    end if;

    perform realtime.send(
      jsonb_build_object(
        'candidateText', v_winner_text,
        'submitterNickname', v_submitter_nickname
      ),
      'draw_opened',
      'room:' || p_room_id::text,
      false
    );
  end if;

  return v_should_open;
end;
$$;

-- ------------------------------------------------------------
-- pg_cronから定期的に呼ぶ: 「みんなで一緒に開ける」で止まっているルームを掃除する。
-- (準備OKが来なくても10秒経過したら開封するための保険)
-- ------------------------------------------------------------
create or replace function gacha.sweep_all_together_draws()
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select id from gacha.rooms
    where status = 'awaiting_open' and open_mode = 'all_together'
  loop
    perform gacha.try_auto_open_draw(r.id);
  end loop;
end;
$$;

