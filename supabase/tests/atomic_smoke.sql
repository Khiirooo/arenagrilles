-- À exécuter après la migration. Toutes les modifications sont annulées.
begin;

select public.arena_apply_mutation(
  'ffg10:scores', 'score_patch',
  '{"gid":"__arena_test_only","aid":"saut","patch":{"e":{"1":8.1}}}'::jsonb
);
select public.arena_apply_mutation(
  'ffg10:scores', 'score_patch',
  '{"gid":"__arena_test_only","aid":"saut","patch":{"e":{"2":8.2}}}'::jsonb
);
select public.arena_apply_mutation(
  'ffg10:scores', 'score_patch',
  '{"gid":"__arena_test_only","aid":"sol","patch":{"e":{"1":9.1}}}'::jsonb
);

do $test$
declare
  v jsonb;
begin
  select value into v from public.kv where key = 'ffg10:scores';
  if (v #>> '{__arena_test_only,saut,e,1}') <> '8.1'
    or (v #>> '{__arena_test_only,saut,e,2}') <> '8.2'
    or (v #>> '{__arena_test_only,sol,e,1}') <> '9.1'
  then
    raise exception 'Échec du test de fusion atomique des notes';
  end if;
  raise notice 'OK : plusieurs juges et plusieurs agrès conservés';
end
$test$;

rollback;
