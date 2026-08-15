-- ============================================================
-- gachaスキーマへのアクセス権限をservice_roleへ付与
-- (最近のSupabaseでは、テーブル/関数を作っただけでは自動的にAPI経由で
--  アクセスできるようにはならず、明示的なGRANTが必要)
-- ============================================================

grant usage on schema gacha to service_role;

grant all on all tables in schema gacha to service_role;
grant all on all sequences in schema gacha to service_role;
grant all on all routines in schema gacha to service_role;

-- 今後gachaスキーマに追加するテーブル/関数にも自動的に同じ権限を適用する
alter default privileges in schema gacha grant all on tables to service_role;
alter default privileges in schema gacha grant all on sequences to service_role;
alter default privileges in schema gacha grant all on routines to service_role;
