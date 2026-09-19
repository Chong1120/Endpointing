-- SafeCall 0002: the support-agent role.
--
-- Roles map to the jobs around a contact centre:
--   admin    runs the workspace (policies, deletes, team, everything below)
--   analyst  studies the safe archive (search, analytics, export)
--   agent    works the calls the AI agent handed over (escalations queue)
--   viewer   looks, and nothing else
--
-- Safe to run more than once.

alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('admin', 'analyst', 'agent', 'viewer'));
