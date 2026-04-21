# Edict — Deployment Runbook

Production deployment procedure for `edict.rectorspace.com`. Single-instance, Docker-based, shared VPS with per-project Linux user. Assumes RECTOR's personal Cloudflare account on CF Full (Strict) mode.

---

## Architecture

```
Internet → Cloudflare (Proxied, TLS)
        → VPS public IP :443 (nginx, TLS, set_real_ip from CF ranges)
        → 127.0.0.1:3000 (Edict app container, Next.js)
        → db:5432 (postgres, not host-exposed)
```

Secrets live in `~/Documents/secret/edict.env` (iCloud-encrypted, never in git). VPS symlinks `.env` → that file at deploy time.

---

## Required environment variables

All required in the VPS `.env` file before first `docker compose up`:

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://edict_app:<pass>@db:5432/edict` | **Must use `@db:5432`** — Docker network hostname, NOT `127.0.0.1:5432` (that's the host loopback, unreachable from inside a container). |
| `DATABASE_ADMIN_URL` | `postgres://edict_admin:<POSTGRES_ADMIN_PASSWORD>@db:5432/edict` | Admin pool for migrations + runtime admin queries + audit writes. Uses the `edict_admin` POSTGRES superuser (created by compose's `POSTGRES_USER`/`POSTGRES_PASSWORD` at container init). SUPERUSER is required because `migrations/0002_rls.sql` runs `CREATE ROLE` — the narrower `edict_admin_role` it creates cannot bootstrap itself. Password = the random `POSTGRES_ADMIN_PASSWORD` value. |
| `POSTGRES_ADMIN_PASSWORD` | `<random 32+ chars>` | Read by compose via `${...:?}` substitution — fails fast if unset. Generate with `openssl rand -base64 32`. |
| `APP_URL` | `https://edict.rectorspace.com` | Magic-link origin; used in email templates. |
| `SESSION_COOKIE_NAME` | `edict_session` | Default; change only if you know why. |
| `RESEND_API_KEY` | `re_xxx` | Production Resend key scoped to `rectorspace.com`. Get from Resend dashboard. |
| `RESEND_FROM` | `edict@rectorspace.com` | Verified sender on the Resend account. |
| `ADMIN_BOOTSTRAP_EMAIL` | `rector@rectorspace.com` | First admin to seed on empty DB. |
| `NODE_ENV` | `production` | Set by Dockerfile runtime stage — do NOT override in `.env`. |

**Do NOT set** `DEV_PRINT_MAGIC_LINKS=true` in production — exposes tokens in stdout.

---

## First-time setup

### 1. VPS user

```bash
sudo adduser edict --disabled-password --gecos ""
sudo usermod -aG docker edict
sudo mkdir -p /home/edict/.ssh
sudo cp ~/.ssh/authorized_keys /home/edict/.ssh/  # or add RECTOR's key manually
sudo chown -R edict:edict /home/edict/.ssh
sudo chmod 700 /home/edict/.ssh
sudo chmod 600 /home/edict/.ssh/authorized_keys
```

SSH in as `edict` from this point forward. SSH password auth must be disabled globally (`/etc/ssh/sshd_config` → `PasswordAuthentication no`). Watch for cloud-init drop-ins re-enabling it.

### 2. Clone + env

As `edict`:

```bash
mkdir -p ~/apps/edict/backups
cd ~/apps/edict
git clone git@github.com:RECTOR-LABS/edict.git .
# Copy the secret env file from your local workstation:
#   scp ~/Documents/secret/edict.env <vps>:~/apps/edict/.env
# OR ssh in and paste manually. Ensure 600 perms.
chmod 600 .env
```

### 3. Cloudflare DNS

On CF dashboard (RECTOR's personal account, `rector@rectorspace.com`):

1. Add A record: `edict` → `<VPS public IP>`, **Proxied**.
2. SSL/TLS mode: **Full (Strict)** — requires a valid origin cert. Let's Encrypt on the VPS satisfies this (see §4). Alternatives: CF Origin CA (15yr cert issued by CF, no certbot needed, swap `ssl_certificate` paths); CF Tunnel (no :80/:443 binding on VPS).

### 4. nginx + TLS cert

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

sudo cp ~/apps/edict/nginx/edict.conf /etc/nginx/sites-available/edict.conf
sudo ln -s /etc/nginx/sites-available/edict.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default  # if present

sudo certbot --nginx -d edict.rectorspace.com \
  --non-interactive --agree-tos --email rector@rectorspace.com

sudo nginx -t && sudo systemctl reload nginx
```

Notes:
- The `set_real_ip_from` and `map $http_upgrade` directives in `edict.conf` are at the `http` context level. Standard Debian/Ubuntu `nginx.conf` includes `sites-enabled/*` from within the `http` block, so the file Just Works there.
- `certbot --nginx` autoresolves the server block and injects managed `ssl_certificate` lines. Verify the final config still reflects Task 53's hardening (TLS 1.2/1.3 only, Mozilla Intermediate ciphers, HSTS).
- Cloudflare refreshes its public IP list periodically; re-sync `set_real_ip_from` ranges every 6 months from <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>.

### 5. First deploy

```bash
cd ~/apps/edict
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps           # both services should be healthy
docker compose -f docker-compose.prod.yml logs app --tail=50
```

Migrations run automatically on app container startup (`CMD: pnpm db:migrate && exec pnpm start`). If they fail the app won't listen on :3000 — check logs.

### 6. Seed first admin

```bash
docker compose -f docker-compose.prod.yml exec app pnpm edict:admin:seed rector@rectorspace.com
```

This writes the first row in `admins` and emails a magic-link to `rector@rectorspace.com`. Open the link, land at `/admin`.

### 7. Nightly backup cron

```bash
crontab -e
# Add:
0 3 * * * /home/edict/apps/edict/scripts/backup.sh >> /home/edict/apps/edict/backups/backup.log 2>&1
```

Weekly off-VPS replication (R2/S3/restic) is a separate concern — set up via `rclone sync` or similar. Local retention is 14 days (handled by `backup.sh`).

---

## Deploy updates

```bash
cd ~/apps/edict
git fetch && git log --oneline HEAD..origin/main   # preview inbound commits
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f                              # clean dangling layers
```

Post-deploy smoke check:

```bash
curl -fsS https://edict.rectorspace.com/ > /dev/null && echo "landing ok"
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs app --tail=50
```

---

## Rollback

```bash
cd ~/apps/edict
git log --oneline -20              # pick known-good sha
git checkout <sha>
docker compose -f docker-compose.prod.yml up -d --build
```

Migration rollback is NOT automatic. If the revert crosses a schema change, manually reverse the relevant migration SQL via:

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U edict_admin edict
```

Treat destructive schema changes as irreversible during Phase 1 — restore from the previous night's backup if needed (see Restore below).

---

## Backup + restore

### Trigger manual backup

```bash
/home/edict/apps/edict/scripts/backup.sh
```

### Restore from a dump

```bash
cd ~/apps/edict

# Stop app to prevent concurrent writes
docker compose -f docker-compose.prod.yml stop app

# Restore (uncompress inline)
gunzip -c backups/2026-04-21.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db \
  psql -U edict_admin -d edict

# Restart app
docker compose -f docker-compose.prod.yml start app
```

For a fresh-DB restore (new VPS), ensure the target DB is empty (`DROP DATABASE edict; CREATE DATABASE edict OWNER edict_admin;`) before piping the dump in.

---

## Operations

### Admin console access

```bash
# Live app shell (node)
docker compose -f docker-compose.prod.yml exec app sh

# Postgres shell
docker compose -f docker-compose.prod.yml exec -T db psql -U edict_admin edict

# Tail app logs
docker compose -f docker-compose.prod.yml logs app --tail=200 -f
```

### Add a new admin

```bash
docker compose -f docker-compose.prod.yml exec app pnpm edict:admin:invite <email>
```

Sends a magic-link email to the new admin. They sign in, gain `/admin` access.

### Revoke a compromised session

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U edict_admin edict \
  -c "UPDATE sessions SET revoked_at = now() WHERE id = '<session_id>';"
```

Or via `/admin` UI → session list.

### Force magic-link token expiry for an email

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U edict_admin edict \
  -c "UPDATE magic_link_tokens SET revoked_at = now() WHERE email = '<email>' AND consumed_at IS NULL;"
```

---

## Health check commands

```bash
# Is CF serving the right origin?
curl -sS -D- https://edict.rectorspace.com/ -o /dev/null | head -20

# Is nginx proxying correctly?
curl -sS http://127.0.0.1:3000/ -o /dev/null -w "%{http_code}\n"  # run on VPS

# Is DB reachable?
docker compose -f docker-compose.prod.yml exec -T db pg_isready -U edict_admin -d edict

# Are migrations up-to-date?
docker compose -f docker-compose.prod.yml exec -T db psql -U edict_admin -d edict \
  -c "SELECT id FROM drizzle_migrations ORDER BY id DESC LIMIT 5;"
```

---

## Known gotchas

1. **DATABASE_URL must use `@db:5432`, not `@127.0.0.1:5432`** — the app container reaches postgres over the compose network, not the host loopback. Wrong URL manifests as `ECONNREFUSED` on first `pnpm db:migrate`.

2. **`edict_admin_role` is unused — chicken-and-egg on migration bootstrap** — `migrations/0002_rls.sql` creates a BYPASSRLS role `edict_admin_role` with intent to be the runtime admin identity (narrower than the superuser). But `drizzle-kit migrate` running `0002_rls.sql` requires SUPERUSER to execute `CREATE ROLE`; the role it's creating cannot bootstrap itself. For now `DATABASE_ADMIN_URL` uses the `edict_admin` superuser for both migration and runtime admin queries. To phase in the narrower role post-launch without refactor:
   - Run the first migration with the superuser (as documented).
   - Then `ALTER USER edict_admin_role WITH PASSWORD '<rotated-pass>';`
   - Split env into `DATABASE_MIGRATION_URL` (superuser) + `DATABASE_ADMIN_URL` (edict_admin_role), update drizzle.config.ts to read the migration URL, and `lib/db/index.ts` to keep using `DATABASE_ADMIN_URL`. Phase 2 hygiene.

3. **Migration-on-startup race** — `CMD ["sh", "-c", "pnpm db:migrate && exec pnpm start"]` runs migrations on every container start. Fine for single instance. If Phase J scales to multiple app containers, extract migrations into a one-shot init container (`deploy.init`) and have the app service depend on its successful completion.

4. **CF IP list drift** — `set_real_ip_from` directives in `nginx/edict.conf` are dated; CF publishes updates at `https://www.cloudflare.com/ips-v{4,6}`. Refresh every ~6 months to avoid edge-IP-as-client-IP when a new CF range is added.

5. **Docker log accumulation** — compose caps logs at 10m/3 files per service (30m total). Beyond that Docker rotates. Still, watch `/var/lib/docker/containers/<id>/*.log` on a long-running VPS; `docker compose down && up -d` resets. `docker system prune` is DESTRUCTIVE on a shared VPS — use only `docker image prune -f` per VPS ops convention.

6. **Cloudflare mode swap** — if changing from CF Full (Strict) to CF Origin CA:
   - Generate CF Origin cert (15yr) from CF dashboard → SSL/TLS → Origin Server.
   - Place cert + key on VPS (e.g. `/etc/ssl/edict/origin.pem`, `/etc/ssl/edict/origin.key`).
   - Update `ssl_certificate` paths in `nginx/edict.conf`.
   - Remove certbot renewal cron (if present).

7. **Rate-limit enforcement not yet wired** — Task 42b deferred. `requestMagicLinkAction` + `shareDocAction` dispatch Resend emails without per-origin throttling. Acceptable for Phase 1 (small user base, CF DDoS at edge) but add before wider rollout.

---

## Escalation

Production issues → check in order:
1. `docker compose logs app --tail=200`
2. `sudo tail -200 /var/log/nginx/edict.error.log`
3. DB query: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;`
4. Cloudflare dashboard → Security → Events (for any edge-side blocks)

Tenant-isolation incident (e.g., one client reports seeing another's doc): **treat as critical**, pull a full pg_dump of audit_log immediately, then triage. Cross-tenant leaks are project-ending per CLAUDE.md.
