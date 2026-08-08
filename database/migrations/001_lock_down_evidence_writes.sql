-- ProofLens server-only data boundary
--
-- The mobile and web clients use Supabase Auth only. All application-table
-- reads and writes pass through the ProofLens API, whose service_role client
-- performs ownership checks and the authoritative S3 re-hash. This migration
-- makes that architecture true at the database privilege boundary as well.
--
-- Designed to be transactional and idempotent on schema_clean.sql and on the
-- original deployed prototype schema.

begin;

-- Refuse to add ownership constraints if existing data would violate them.
do $$
begin
  if exists (
    select 1
    from public.verification_shares s
    left join public.credentials c on c.id = s.capture_id
    where c.id is null or s.user_id is distinct from c.user_id
  ) then
    raise exception 'preflight failed: verification_shares contains an orphan or owner mismatch';
  end if;

  if exists (
    select 1
    from public.audio_shares s
    left join public.audio_records a on a.id = s.audio_id
    where a.id is null or s.user_id is distinct from a.user_id
  ) then
    raise exception 'preflight failed: audio_shares contains an orphan or owner mismatch';
  end if;
end
$$;

-- The Data API is not an application data path. Remove every direct client
-- privilege and policy, while preserving unrestricted server-side access for
-- service_role. FORCE RLS is defence in depth for non-BYPASSRLS roles.
do $$
declare
  object_name text;
  policy_row record;
begin
  foreach object_name in array array[
    'device_keys', 'device_key_audit', 'upload_audit', 'bursts', 'credentials',
    'drafts', 'audio_records', 'audio_drafts', 'verification_shares', 'audio_shares'
  ] loop
    if to_regclass(format('public.%I', object_name)) is null then
      raise exception 'required table public.% is missing', object_name;
    end if;

    execute format('alter table public.%I enable row level security', object_name);
    execute format('alter table public.%I force row level security', object_name);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', object_name);
    execute format('grant all privileges on table public.%I to service_role', object_name);
  end loop;

  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'device_keys', 'device_key_audit', 'upload_audit', 'bursts', 'credentials',
        'drafts', 'audio_records', 'audio_drafts', 'verification_shares', 'audio_shares'
      ])
  loop
    execute format('drop policy %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end
$$;

revoke all privileges on table public.v_queue from public, anon, authenticated;
grant select on table public.v_queue to service_role;
alter view public.v_queue set (security_invoker = on);

comment on view public.v_queue is
  'Server-only queue view. security_invoker is enabled and browser roles have no privileges.';
comment on table public.credentials is
  'Image evidence credentials, written by the API only after server-side object re-hash.';
comment on table public.audio_records is
  'Audio evidence records, written by the API only after server-side object re-hash.';

-- Do not let future tables, sequences, or functions silently regain the broad
-- defaults that caused the original Data API exposure.
revoke all privileges on all sequences in schema public from public, anon, authenticated;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- Public-schema functions are internal API/trigger helpers, not client RPCs.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', fn.identity);
    execute format('grant execute on function %s to service_role', fn.identity);
  end loop;
end
$$;

alter function public._append_only_block_updates() set search_path = pg_catalog, public;
alter function public._audio_records_tsa_only_updates() set search_path = pg_catalog, public;
alter function public._credentials_tsa_only_updates() set search_path = pg_catalog, public;
alter function public._device_keys_revoke_only_updates() set search_path = pg_catalog, public;
alter function public.get_shared_credential(text) set search_path = pg_catalog, public, extensions;

-- Database-enforced owner equality for shares. Existing legacy credentials may
-- have a null user_id, but no share can reference them because share ownership
-- columns are non-null and the composite foreign keys require an exact match.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.credentials'::regclass
      and conname = 'credentials_id_user_uniq'
  ) then
    alter table public.credentials
      add constraint credentials_id_user_uniq unique (id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audio_records'::regclass
      and conname = 'audio_records_id_user_uniq'
  ) then
    alter table public.audio_records
      add constraint audio_records_id_user_uniq unique (id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.verification_shares'::regclass
      and conname = 'verification_shares_owner_fk'
  ) then
    alter table public.verification_shares
      add constraint verification_shares_owner_fk
      foreign key (capture_id, user_id)
      references public.credentials (id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audio_shares'::regclass
      and conname = 'audio_shares_owner_fk'
  ) then
    alter table public.audio_shares
      add constraint audio_shares_owner_fk
      foreign key (audio_id, user_id)
      references public.audio_records (id, user_id)
      on delete cascade;
  end if;
end
$$;

comment on constraint verification_shares_owner_fk on public.verification_shares is
  'A share must have the same owner as the capture it references.';
comment on constraint audio_shares_owner_fk on public.audio_shares is
  'A share must have the same owner as the audio record it references.';

create index if not exists verification_shares_owner_idx
  on public.verification_shares (capture_id, user_id);
create index if not exists audio_shares_owner_idx
  on public.audio_shares (audio_id, user_id);
create index if not exists credentials_burst_id_idx
  on public.credentials (burst_id);
create index if not exists drafts_burst_id_idx
  on public.drafts (burst_id);

-- Remove known duplicate indexes from the original development database while
-- retaining the constraint-backed/authoritative copies.
drop index if exists public.idx_credentials_sha256;
drop index if exists public.drafts_user_sha256_unique;
drop index if exists public.drafts_user_sha_unique;

commit;
