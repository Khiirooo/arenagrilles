-- Arena Grilles : synchronisation atomique entre appareils.
-- À exécuter dans Supabase SQL Editor AVANT de déployer la branche.
-- Conservation du schéma kv historique et des données existantes.
-- IMPORTANT : l'authentification par rôles / RLS reste un chantier séparé.
-- Cette migration n'est PAS une politique d'autorisation.

create or replace function public.arena_apply_mutation(
  p_key text, p_action text, p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $arena$
declare
  v jsonb;
  v_item jsonb;
  v_patch jsonb;
  v_cell jsonb;
  v_group jsonb;
  v_id text;
  v_ap text;
  v_token text;
  v_slot text;
  v_occupied boolean;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload JSON invalide' using errcode = '22023';
  end if;

  if not (
    (p_key = 'ffg10:scores' and p_action in ('score_patch', 'score_delete'))
    or (p_key = 'ffg10:roster' and p_action in ('roster_add', 'roster_edit', 'roster_delete'))
    or (p_key = 'ffg10:inquiries' and p_action in ('inquiry_add', 'inquiry_edit'))
    or (p_key = 'ffg10:presence' and p_action in ('presence_beat', 'presence_claim', 'presence_release'))
  ) then
    raise exception 'Mutation non autorisée : % / %', p_key, p_action using errcode = '22023';
  end if;

  -- La ligne est verrouillée pour la totalité de la transaction.
  -- ON CONFLICT DO NOTHING rend l'initialisation concurrente inoffensive.
  insert into public.kv (key, value, updated_at)
  values (p_key,
    case when p_key in ('ffg10:roster', 'ffg10:inquiries') then '[]'::jsonb
         else '{}'::jsonb end,
    now())
  on conflict (key) do nothing;

  select value into v from public.kv where key = p_key for update;
  v_id := nullif(p_payload->>'id', '');
  v_patch := p_payload->'patch';

  if p_action in ('score_patch', 'score_delete') then
    v_id := nullif(p_payload->>'gid', '');
    v_ap := nullif(p_payload->>'aid', '');
    if v_id is null or v_ap is null or length(v_id) > 128 or length(v_ap) > 128 then
      raise exception 'Gymnaste ou agrès invalide' using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'object' then raise exception 'Scores non valides'; end if;
    v_group := coalesce(v->v_id, '{}'::jsonb);
    if p_action = 'score_delete' then
      v_group := v_group - v_ap;
    else
      if jsonb_typeof(v_patch) <> 'object' then raise exception 'Note invalide'; end if;
      v_cell := coalesce(v_group->v_ap, '{}'::jsonb);
      v_cell := v_cell || v_patch || jsonb_build_object(
        'e', coalesce(v_cell->'e', '{}'::jsonb) || coalesce(v_patch->'e', '{}'::jsonb),
        'notes', coalesce(v_cell->'notes', '{}'::jsonb) || coalesce(v_patch->'notes', '{}'::jsonb),
        'ts', v_now
      );
      v_group := jsonb_set(v_group, array[v_ap], v_cell, true);
    end if;
    v := jsonb_set(v, array[v_id], v_group, true);

  elsif p_action in ('roster_add', 'roster_edit', 'roster_delete') then
    if jsonb_typeof(v) <> 'array' then raise exception 'Liste gymnastes invalide'; end if;
    if p_action = 'roster_add' then
      v_item := p_payload->'item';
      v_id := nullif(v_item->>'id', '');
      if jsonb_typeof(v_item) <> 'object' or v_id is null then raise exception 'Inscription invalide'; end if;
      if not exists (select 1 from jsonb_array_elements(v) as x(item) where x.item->>'id' = v_id) then
        v := v || jsonb_build_array(v_item);
      end if;
    elsif p_action = 'roster_edit' then
      if v_id is null or jsonb_typeof(v_patch) <> 'object' then raise exception 'Modification invalide'; end if;
      select coalesce(jsonb_agg(
        case when x.item->>'id' = v_id then x.item || (v_patch - 'id') else x.item end
        order by x.ord
      ), '[]'::jsonb) into v
      from jsonb_array_elements(v) with ordinality as x(item, ord);
    else
      if v_id is null then raise exception 'Identifiant invalide'; end if;
      select coalesce(jsonb_agg(x.item order by x.ord), '[]'::jsonb) into v
      from jsonb_array_elements(v) with ordinality as x(item, ord)
      where x.item->>'id' is distinct from v_id;
    end if;

  elsif p_action in ('inquiry_add', 'inquiry_edit') then
    if jsonb_typeof(v) <> 'array' then raise exception 'Réclamations invalides'; end if;
    if p_action = 'inquiry_add' then
      v_item := p_payload->'item';
      v_id := nullif(v_item->>'id', '');
      if jsonb_typeof(v_item) <> 'object' or v_id is null then raise exception 'Réclamation invalide'; end if;
      if not exists (select 1 from jsonb_array_elements(v) as x(item) where x.item->>'id' = v_id) then
        v := jsonb_build_array(v_item) || v;
      end if;
    else
      if v_id is null or jsonb_typeof(v_patch) <> 'object' then raise exception 'Modification invalide'; end if;
      select coalesce(jsonb_agg(
        case when x.item->>'id' = v_id then x.item || (v_patch - 'id') else x.item end
        order by x.ord
      ), '[]'::jsonb) into v
      from jsonb_array_elements(v) with ordinality as x(item, ord);
    end if;

  elsif p_action in ('presence_beat', 'presence_claim', 'presence_release') then
    v_token := nullif(p_payload->>'token', '');
    v_item := p_payload->'entry';
    v_slot := nullif(p_payload->>'slot', '');
    if v_token is null or length(v_token) > 160 then
      raise exception 'Identifiant de présence invalide' using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'object' then v := '{}'::jsonb; end if;

    -- Supprimer les sessions expirées sous verrou.
    select coalesce(jsonb_object_agg(x.k, x.item), '{}'::jsonb) into v
    from jsonb_each(v) as x(k, item)
    where case when coalesce(x.item->>'ts', '') ~ '^[0-9]+

  update public.kv set value = v, updated_at = now() where key = p_key;
  return v;
end
$arena$;

revoke all on function public.arena_apply_mutation(text, text, jsonb) from public;
-- Compatibilité avec le fonctionnement existant : les autorisations de kv
-- continuent de s'appliquer, car la fonction est SECURITY INVOKER.
grant execute on function public.arena_apply_mutation(text, text, jsonb)
  to anon, authenticated;

-- Realtime : notifier les autres appareils dès la validation de la note.
do $arena$
begin
  alter publication supabase_realtime add table public.kv;
exception
  when duplicate_object then null;
end
$arena$;

      then (x.item->>'ts')::numeric > v_now - 45000 else false end;

    if p_action = 'presence_release' then
      v := v - v_token;
    elsif p_action = 'presence_claim' then
      if v_slot is null
        or v_slot !~ '^juge:(GAF|GAM):[a-z0-9_-]+:(JS|[1-9][0-9]*)

  update public.kv set value = v, updated_at = now() where key = p_key;
  return v;
end
$arena$;

revoke all on function public.arena_apply_mutation(text, text, jsonb) from public;
-- Compatibilité avec le fonctionnement existant : les autorisations de kv
-- continuent de s'appliquer, car la fonction est SECURITY INVOKER.
grant execute on function public.arena_apply_mutation(text, text, jsonb)
  to anon, authenticated;

-- Realtime : notifier les autres appareils dès la validation de la note.
do $arena$
begin
  alter publication supabase_realtime add table public.kv;
exception
  when duplicate_object then null;
end
$arena$;

        or left(v_token, length(v_slot) + 1) <> v_slot || ':'
        or jsonb_typeof(v_item) <> 'object' then
        raise exception 'Poste de juge invalide' using errcode = '22023';
      end if;
      select exists (
        select 1 from jsonb_each(v) as x(k, item)
        where left(x.k, length(v_slot) + 1) = v_slot || ':'
        and x.k <> v_token
      ) into v_occupied;
      if v_occupied then
        raise exception 'Ce poste est déjà occupé par un autre appareil. Réessayez dans 45 s si la session précédente est fermée.'
          using errcode = 'P0001';
      end if;
      v := v || jsonb_build_object(v_token, v_item || jsonb_build_object('ts', v_now));
    else
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'Présence invalide' using errcode = '22023';
      end if;
      -- Un juge ne peut pas récupérer un poste dont il a perdu la réservation.
      if left(v_token, 5) = 'juge:' and not (v ? v_token) then
        raise exception 'Réservation du poste de juge expirée : reconnectez-vous.'
          using errcode = 'P0001';
      end if;
      v := v || jsonb_build_object(v_token, v_item || jsonb_build_object('ts', v_now));
    end if;
  end if;

  update public.kv set value = v, updated_at = now() where key = p_key;
  return v;
end
$arena$;

revoke all on function public.arena_apply_mutation(text, text, jsonb) from public;
-- Compatibilité avec le fonctionnement existant : les autorisations de kv
-- continuent de s'appliquer, car la fonction est SECURITY INVOKER.
grant execute on function public.arena_apply_mutation(text, text, jsonb)
  to anon, authenticated;

-- Realtime : notifier les autres appareils dès la validation de la note.
do $arena$
begin
  alter publication supabase_realtime add table public.kv;
exception
  when duplicate_object then null;
end
$arena$;
