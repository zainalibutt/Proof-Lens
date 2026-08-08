-- ProofLens database-boundary regression test.
--
-- Run as an administrative role after 001_lock_down_evidence_writes.sql.
-- All fixtures are synthetic and the transaction always rolls back.

begin;

do $$
declare
  object_name text;
  role_name text;
  privilege_name text;
  policy_count integer;
  accepted boolean;
  user_a constant uuid := '11111111-1111-4111-8111-111111111111';
  user_b constant uuid := '22222222-2222-4222-8222-222222222222';
  capture_a constant uuid := 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  audio_a constant uuid := 'cccccccc-3333-4333-8333-cccccccccccc';
begin
  -- Browser roles have no application table/view privileges at all.
  foreach object_name in array array[
    'device_keys', 'device_key_audit', 'upload_audit', 'bursts', 'credentials',
    'drafts', 'audio_records', 'audio_drafts', 'verification_shares',
    'audio_shares', 'v_queue'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      foreach privilege_name in array array[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] loop
        if has_table_privilege(role_name, format('public.%I', object_name), privilege_name) then
          raise exception 'FAIL: % still has % on public.%', role_name, privilege_name, object_name;
        end if;
      end loop;
    end loop;
  end loop;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array[
      'device_keys', 'device_key_audit', 'upload_audit', 'bursts', 'credentials',
      'drafts', 'audio_records', 'audio_drafts', 'verification_shares', 'audio_shares'
    ]);
  if policy_count <> 0 then
    raise exception 'FAIL: % obsolete client policies remain', policy_count;
  end if;

  if not coalesce(
    (select 'security_invoker=on' = any(reloptions)
     from pg_class where oid = 'public.v_queue'::regclass), false
  ) then
    raise exception 'FAIL: public.v_queue is not security_invoker';
  end if;

  if not (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class
    where oid = any(array[
      'public.device_keys'::regclass, 'public.device_key_audit'::regclass,
      'public.upload_audit'::regclass, 'public.bursts'::regclass,
      'public.credentials'::regclass, 'public.drafts'::regclass,
      'public.audio_records'::regclass, 'public.audio_drafts'::regclass,
      'public.verification_shares'::regclass, 'public.audio_shares'::regclass
    ])
  ) then
    raise exception 'FAIL: an application table is missing ENABLE/FORCE RLS';
  end if;

  if has_function_privilege('anon', 'public.get_shared_credential(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_shared_credential(text)', 'EXECUTE') then
    raise exception 'FAIL: client role can execute server-only share RPC';
  end if;

  -- Minimal parent fixtures. Required evidence fields are synthetic.
  insert into public.credentials
    (id, user_id, sha256, signature_b64, media_key)
  values
    (capture_a, user_a, repeat('a', 64), 'synthetic-signature', 'users/synthetic/capture.jpg');

  insert into public.audio_records (id, user_id, sha256, signature, s3_key)
  values (audio_a, user_a, repeat('b', 64), 'synthetic-signature', 'users/synthetic/audio.m4a');

  -- Cross-tenant capture share must fail specifically at the composite FK.
  accepted := false;
  begin
    insert into public.verification_shares (user_id, capture_id, token_hash, expires_at)
    values (user_b, capture_a, 'synthetic-capture-cross-tenant', now() + interval '1 hour');
    accepted := true;
  exception when foreign_key_violation then
    accepted := false;
  end;
  if accepted then
    raise exception 'FAIL: cross-tenant capture share was accepted';
  end if;

  insert into public.verification_shares (user_id, capture_id, token_hash, expires_at)
  values (user_a, capture_a, 'synthetic-capture-same-tenant', now() + interval '1 hour');

  -- Repeat the negative and positive cases for audio.
  accepted := false;
  begin
    insert into public.audio_shares (user_id, audio_id, token_hash, expires_at)
    values (user_b, audio_a, 'synthetic-audio-cross-tenant', now() + interval '1 hour');
    accepted := true;
  exception when foreign_key_violation then
    accepted := false;
  end;
  if accepted then
    raise exception 'FAIL: cross-tenant audio share was accepted';
  end if;

  insert into public.audio_shares (user_id, audio_id, token_hash, expires_at)
  values (user_a, audio_a, 'synthetic-audio-same-tenant', now() + interval '1 hour');

  raise notice 'PASS: ProofLens database boundary and ownership constraints';
end
$$;

rollback;
