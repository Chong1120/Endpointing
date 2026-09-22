-- SafeCall 0003: the customer role.
--
-- A customer is the person who calls the AI agent. They are not staff: they
-- see the calls they made and nothing else in the workspace, which the API
-- enforces (backend/src/domain/permissions.ts).
--
-- Safe to run more than once.

alter table public.users drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (role in ('admin', 'analyst', 'agent', 'viewer', 'customer'));
