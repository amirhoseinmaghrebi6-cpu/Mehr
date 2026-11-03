-- Signed firmware (docs/board-protocol.md, "Firmware updates"): every release carries our ECDSA
-- signature of its image, made offline with firmware/sign.mjs; boards install only what it
-- verifies, so the server cannot send a firmware nobody signed. Releases uploaded before signing
-- existed (development only) are dropped: no board would accept them.

alter table public.firmware_releases add column if not exists signature text;
delete from public.firmware_releases where signature is null;
alter table public.firmware_releases alter column signature set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'firmware_releases_signature_check') then
    alter table public.firmware_releases add constraint firmware_releases_signature_check
      check (signature ~ '^[A-Za-z0-9+/]+=*$' and char_length(signature) <= 120);
  end if;
end;
$$;
