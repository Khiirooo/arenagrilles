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
  v_backup text;
  v_scores jsonb;
  v_roster jsonb;
  v_config jsonb;
  v_gym jsonb;
  v_div jsonb;
  v_note jsonb;
  v_count integer;
  v_j integer;
  v_limit numeric;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload JSON invalide' using errcode = '22023';
  end if;

  if not (
    (p_key = 'ffg10:scores' and p_action in ('score_patch', 'score_delete', 'scores_reset'))
    or (p_key = 'ffg10:roster' and p_action in ('roster_add', 'roster_edit', 'roster_delete', 'roster_replace_cas', 'competition_reset'))
    or (p_key = 'ffg10:inquiries' and p_action in ('inquiry_add', 'inquiry_edit'))
    or (p_key = 'ffg10:presence' and p_action in ('presence_beat', 'presence_claim', 'presence_release'))
    or (p_key = 'ffg10:log' and p_action = 'log_add')
    or (p_key = 'ffg10:chat' and p_action = 'chat_add')
    or (p_key = 'ffg10:config' and p_action = 'config_cas')
    or (p_key = 'ffg10:live' and p_action = 'live_cas')
  ) then
    raise exception 'Mutation non autorisée : % / %', p_key, p_action using errcode = '22023';
  end if;

  -- La ligne est verrouillée pour la totalité de la transaction.
  -- ON CONFLICT DO NOTHING rend l'initialisation concurrente inoffensive.
  insert into public.kv (key, value, updated_at)
  values (p_key,
    case when p_key in ('ffg10:roster', 'ffg10:inquiries', 'ffg10:log', 'ffg10:chat') then '[]'::jsonb
         else '{}'::jsonb end,
    now())
  on conflict (key) do nothing;

  select value into v from public.kv where key = p_key for update;
  v_id := nullif(p_payload->>'id', '');
  v_patch := p_payload->'patch';

  if p_action in ('config_cas', 'live_cas', 'roster_replace_cas') then
    if v is distinct from p_payload->'expected' then
      raise exception 'Données modifiées sur un autre appareil : réactualisez avant de sauvegarder'
        using errcode = '40001';
    end if;
    if (p_action = 'roster_replace_cas' and jsonb_typeof(p_payload->'value') <> 'array')
      or (p_action <> 'roster_replace_cas' and jsonb_typeof(p_payload->'value') <> 'object') then
      raise exception 'Format invalide' using errcode = '22023';
    end if;
    v := p_payload->'value';
  elsif p_action = 'scores_reset' then
    v_backup := 'ffg10:backup:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
      || ':' || substr(md5(random()::text), 1, 8);
    insert into public.kv (key, value, updated_at)
      values (v_backup, jsonb_build_object('kind','scores_reset','scores',v), now());
    v := '{}'::jsonb;
  elsif p_action = 'competition_reset' then
    insert into public.kv (key, value, updated_at)
      values ('ffg10:scores','{}'::jsonb,now()) on conflict (key) do nothing;
    select value into v_scores from public.kv where key='ffg10:scores' for update;
    v_backup := 'ffg10:backup:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
      || ':' || substr(md5(random()::text), 1, 8);
    insert into public.kv (key, value, updated_at)
      values (v_backup, jsonb_build_object('kind','competition_reset','scores',v_scores,'roster',v),now());
    update public.kv set value='{}'::jsonb, updated_at=now() where key='ffg10:scores';
    v := '[]'::jsonb;
  elsif p_action in ('score_patch', 'score_delete') then
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
      if v_patch->>'status' in ('submitted', 'validated') then
        select value into v_roster from public.kv where key='ffg10:roster';
        select value into v_config from public.kv where key='ffg10:config';
        if jsonb_typeof(v_roster) <> 'array' or jsonb_typeof(v_config->'divisions') <> 'array' then
          raise exception 'Configuration absente' using errcode='22023';
        end if;
        select x.item into v_gym from jsonb_array_elements(v_roster) as x(item)
          where x.item->>'id'=v_id limit 1;
        select x.item into v_div from jsonb_array_elements(v_config->'divisions') as x(item)
          where x.item->>'id'=v_gym->>'division' limit 1;
        if v_div is null then raise exception 'Division inconnue' using errcode='22023'; end if;
        if coalesce(v_div->>'judges','') !~ '^[1-9][0-9]*$' then
          raise exception 'Nombre de juges invalide' using errcode='22023';
        end if;
        v_count := (v_div->>'judges')::integer;
        if v_count > 20 then raise exception 'Panel invalide' using errcode='22023'; end if;
        if coalesce(v_div->>'start','') !~ '^[0-9]+([.][0-9]+)?$' then
          raise exception 'Barème invalide' using errcode='22023';
        end if;
        v_limit := (v_div->>'start')::numeric;
        if v_limit <= 0 then raise exception 'Barème invalide' using errcode='22023'; end if;
        if v_div->>'mode'='DE' then
          v_note := v_cell->'d';
          if jsonb_typeof(v_note) <> 'number' then
            raise exception 'Note D manquante' using errcode='22023';
          end if;
          if (v_note #>> '{}')::numeric < 0 then
            raise exception 'Note D négative' using errcode='22023';
          end if;
        end if;
        for v_j in 1..v_count loop
          v_note := v_cell #> array[
            case when v_div->>'mode'='DE' then 'e' else 'notes' end, v_j::text
          ];
          if jsonb_typeof(v_note) <> 'number' then
            raise exception 'Note du juge % manquante', v_j using errcode='22023';
          end if;
          if (v_note #>> '{}')::numeric < 0 or (v_note #>> '{}')::numeric > v_limit then
            raise exception 'Note du juge % hors barème', v_j using errcode='22023';
          end if;
        end loop;
        v_note := v_cell->'pen';
        if v_note is not null and jsonb_typeof(v_note) <> 'null' then
          if jsonb_typeof(v_note) <> 'number' then
            raise exception 'Pénalité invalide' using errcode='22023';
          end if;
          if (v_note #>> '{}')::numeric < 0 or (v_note #>> '{}')::numeric > 5 then
            raise exception 'Pénalité hors barème' using errcode='22023';
          end if;
        end if;
      end if;
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

  elsif p_action in ('log_add', 'chat_add') then
    v_item := p_payload->'item';
    v_id := nullif(v_item->>'id','');
    if v_id is null or length(v_id)>120 or jsonb_typeof(v_item)<>'object'
      or length(btrim(coalesce(v_item->>'text','')))=0
      or length(v_item->>'text')>1000 then
      raise exception 'Message invalide' using errcode='22023';
    end if;
    if jsonb_typeof(v)<>'array' then raise exception 'Historique invalide'; end if;
    if not exists (select 1 from jsonb_array_elements(v) as x(item) where x.item->>'id'=v_id) then
      v_item := jsonb_build_object('id',v_id,'ts',v_now,
        'author',left(coalesce(v_item->>'author','Superviseur'),80),
        'text',btrim(v_item->>'text'));
      if p_action='log_add' then
        v := jsonb_build_array(v_item) || v;
        select coalesce(jsonb_agg(y.item order by y.ord),'[]'::jsonb) into v
          from (select x.item,x.ord from jsonb_array_elements(v) with ordinality as x(item,ord)
            order by x.ord limit 100) y;
      else
        v := v || jsonb_build_array(v_item);
        select coalesce(jsonb_agg(y.item order by y.ord),'[]'::jsonb) into v
          from (select x.item,x.ord from jsonb_array_elements(v) with ordinality as x(item,ord)
            order by x.ord desc limit 100) y;
      end if;
    end if;
  elsif p_action in ('presence_beat','presence_claim','presence_release') then
    v_token := nullif(p_payload->>'token','');
    v_item := p_payload->'entry';
    v_slot := nullif(p_payload->>'slot','');
    if v_token is null or length(v_token)>160 then
      raise exception 'Identifiant de présence invalide' using errcode='22023';
    end if;
    if jsonb_typeof(v)<>'object' then v:='{}'::jsonb; end if;
    select coalesce(jsonb_object_agg(x.k,x.item),'{}'::jsonb) into v
      from jsonb_each(v) as x(k,item)
      where case when coalesce(x.item->>'ts','') ~ '^[0-9]+$'
        then (x.item->>'ts')::numeric > v_now-45000 else false end;
    if p_action='presence_release' then
      v := v-v_token;
    elsif p_action='presence_claim' then
      if v_slot is null
        or v_slot !~ '^juge:(GAF|GAM):[a-z0-9_-]+:(JS|[1-9][0-9]*)$'
        or left(v_token,length(v_slot)+1)<>v_slot||':'
        or jsonb_typeof(v_item)<>'object' then
        raise exception 'Poste de juge invalide' using errcode='22023';
      end if;
      select exists (select 1 from jsonb_each(v) as x(k,item)
        where left(x.k,length(v_slot)+1)=v_slot||':' and x.k<>v_token)
        into v_occupied;
      if v_occupied then
        raise exception 'Poste déjà occupé : attendez 45 secondes après la fermeture'
          using errcode='P0001';
      end if;
      v := v || jsonb_build_object(v_token,v_item || jsonb_build_object('ts',v_now));
    else
      if jsonb_typeof(v_item)<>'object' then
        raise exception 'Présence invalide' using errcode='22023';
      end if;
      if left(v_token,5)='juge:' and not (v ? v_token) then
        raise exception 'Réservation du poste de juge expirée : reconnectez-vous'
          using errcode='P0001';
      end if;
      v := v || jsonb_build_object(v_token,v_item || jsonb_build_object('ts',v_now));
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
