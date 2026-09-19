-- Preserve already-published migration history. Repair only the exact qualified
-- local-variable references introduced by 006; auth.uid() is the authenticated
-- actor already captured at entry, not an ID supplied in the request body.
-- Function parameters have implicit function-name scope in PL/pgSQL; DECLARE
-- locals do not. Assert the expected source before replacing either function.
do $migration$
declare definition text; signature text; old_ref text; occurrences integer;
begin
 for signature,old_ref,occurrences in values
  ('public.learning_command(text,uuid,uuid,integer,jsonb,uuid)','learning_command.actor',2),
  ('public.learning_invite(uuid,uuid)','learning_invite.actor',2)
 loop
  definition := pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,old_ref,'')))/length(old_ref) <> occurrences then
   raise exception 'unexpected_rpc_definition: %', signature;
  end if;
  definition := replace(definition,old_ref,'auth.uid()');
  execute definition;
 end loop;
end $migration$;
