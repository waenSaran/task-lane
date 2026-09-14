alter table repositories
  add column if not exists preset_related_repo_ids text[] not null default '{}';

drop index if exists repositories_ssh_url_uidx;
create unique index repositories_ssh_url_uidx on repositories (lower(ssh_url));
