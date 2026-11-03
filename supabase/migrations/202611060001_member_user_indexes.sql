-- Load test (2026-11-03, docs/audit/2026-11-security.md): every page asks for the user's
-- organizations, and organization_members had no index on user_id. With its row-level security
-- policy, PostgreSQL scanned every membership row and ran the policy's function on each one: the
-- database's CPU was full at 150 requests a second, and the cost grows with every new user.
-- property_members already has this index.

create index if not exists organization_members_user_id_idx on public.organization_members (user_id);
