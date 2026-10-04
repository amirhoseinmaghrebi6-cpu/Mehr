-- A board can be added to a home before it is paired: an owner or admin picks the product, names
-- its channels and puts them in rooms; the board then waits for pairing. Such a board has no
-- hardware id yet (hardware_uid is null). Pairing it sets the hardware id of a real board of the
-- same model. Additive: a rule is relaxed and two functions are replaced.
alter table public.controllers alter column hardware_uid drop not null;

-- A board never changes home or model. Its hardware id is set once, when a pending board is
-- paired, and never changes afterwards.
create or replace function public.protect_controller_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.property_id <> old.property_id or new.model_id <> old.model_id
    or (old.hardware_uid is not null and new.hardware_uid is distinct from old.hardware_uid) then
    raise exception 'A controller''s home, model and hardware id cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_controller_identity() from public, anon, authenticated;

-- p_hardware_uid null: a board waiting to be paired.
create or replace function public.provision_controller(p_hub_id uuid, p_model_code text, p_hardware_uid text, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_property_id uuid;
  v_model_id uuid;
  v_controller_id uuid;
begin
  select hub.property_id into v_property_id from public.hubs as hub where hub.id = p_hub_id;
  if v_property_id is null then
    raise exception 'Unknown hub %', p_hub_id using errcode = '23503';
  end if;
  select model.id into v_model_id from public.hardware_models as model where model.code = p_model_code;
  if v_model_id is null then
    raise exception 'Unknown hardware model %', p_model_code using errcode = '23503';
  end if;
  if not exists (select 1 from public.hardware_model_channels where model_id = v_model_id) then
    raise exception 'Hardware model % has no channels', p_model_code using errcode = '23514';
  end if;
  if not exists (select 1 from public.hardware_model_pins where model_id = v_model_id and function = 'setup_button') then
    raise exception 'Hardware model % has no setup button; it cannot be paired or reset', p_model_code using errcode = '23514';
  end if;

  insert into public.controllers (property_id, hub_id, model_id, hardware_uid, name)
  values (v_property_id, p_hub_id, v_model_id, p_hardware_uid, btrim(p_name))
  returning id into v_controller_id;

  insert into public.devices (property_id, hub_id, external_id, name, device_type, controller_id, model_id, channel_key)
  select v_property_id, p_hub_id, coalesce(p_hardware_uid, 'pending-' || v_controller_id) || ':' || channel.channel_key, channel.default_name,
    channel.device_type, v_controller_id, v_model_id, channel.channel_key
  from public.hardware_model_channels as channel
  where channel.model_id = v_model_id;

  insert into public.device_capabilities (property_id, device_id, capability, value_type, min_value, max_value, step, enum_values, unit, writable)
  select v_property_id, device.id, template.capability, template.value_type, template.min_value, template.max_value,
    template.step, template.enum_values, template.unit, template.writable
  from public.devices as device
  join public.hardware_model_capabilities as template
    on template.model_id = device.model_id and template.channel_key = device.channel_key
  where device.controller_id = v_controller_id;

  return v_controller_id;
end;
$$;
revoke all on function public.provision_controller(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_controller(uuid, text, text, text) to service_role;
