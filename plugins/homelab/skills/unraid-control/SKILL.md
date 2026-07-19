---
schemaVersion: 0.1.0
name: unraid-control
description: "Use when the user wants to observe or control an Unraid server (their NAS / tower / box) — checking health, system metrics, the storage array and parity, physical disks, user shares, Docker containers, virtual machines, UPS power, or notifications; when starting/stopping/updating any of those; or when the Unraid web UI is unresponsive/hung and needs diagnosis. Teaches the agent to drive either the unraid MCP tools or the `unraid` CLI, the read-only / safe-write / destructive safety model that gates writes, and a D-state I/O-saturation hang recovery playbook."
---

# Engaging with an Unraid server

This skill teaches you to observe and control an [Unraid](https://unraid.net) server through
its GraphQL API (Unraid 7.2+). There are two surfaces — use whichever is wired up:

- **MCP tools** (names start with `unraid_`) — preferred when present. You call them directly.
- **The `unraid` CLI** — run via the shell (`unraid <group> <command>`). Use when no MCP tools
  are available or the user asks for the CLI.

Both are thin wrappers over the same core operations and the same safety model, so the recipes
below map cleanly between them.

## Step 0 — Detect the available surface

1. **Look for MCP tools.** If you can see tools named `unraid_connection_health`,
   `unraid_array_status`, etc., use the MCP path. Confirm reachability first with
   `unraid_connection_health`.
2. **Otherwise try the CLI.** Run `unraid --help`. If it resolves, use the CLI path and confirm
   reachability with `unraid health`. If it does not resolve, the CLI is not installed — tell
   the user how to install it (see *Setup* below) rather than guessing.
3. **Never invent tools or flags.** For the CLI, discover exact subcommands and options with
   `unraid <group> --help` (e.g. `unraid docker --help`). For MCP, read the tool's own
   description/inputSchema.

## Setup (connection)

Both surfaces resolve the connection from the same environment variables (CLI flags override):

| Variable                 | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `UNRAID_API_URL`         | GraphQL endpoint, e.g. `https://<host>/graphql`                    |
| `UNRAID_API_KEY`         | Unraid API key, sent as `x-api-key` (prefer a least-privilege key) |
| `UNRAID_TLS_SKIP_VERIFY` | `true` to accept Unraid's self-signed local cert                   |

Get the API key from the Unraid web UI: **Settings → Management Access → API Keys**.

- **MCP path:** these are passed to the server via the plugin's bundled `.mcp.json`, which runs
  the `unraid` MCP server over stdio. If a server is already running on the Unraid box over
  HTTP, the user points their client at it instead — you just call the tools.
- **CLI path:** install the CLI with `npm i -g unraid-toolkit` (provides the `unraid` command),
  then export the env vars or pass `--url`, `--api-key`, and `--insecure` per call. CLI output
  is JSON by default; add `--human` for readable text.

## The safety model (read this before any write)

Every operation is classified into one of three tiers. **Know which tier you are about to
invoke and behave accordingly.**

| Tier            | Examples                                                              | What you must do |
| --------------- | ---------------------------------------------------------------------- | ----------------- |
| **Read-only**   | health, system info/metrics, list/status/overview, logs, history       | Safe and idempotent. Call freely. |
| **Safe write**  | start/stop/pause/unpause/update a container; start/stop/pause/resume a VM; archive a notification; pause/resume a parity check | Reversible, low-risk. State changes — say what you're about to do, then do it. |
| **Destructive** | start/stop the **array**; add/remove/mount/unmount a disk; start/cancel a parity check; remove a container; reboot/force-stop/reset a VM | Irreversible or high-blast-radius. Requires explicit human approval (below). Never auto-approve. |

**Server-side policy floor (MCP).** The server can refuse a write regardless of what you ask,
and the refusal is not your fault — surface it to the user:

- `MCP_READ_ONLY=true` disables **all** writes (the bundled config defaults to this; the user
  must deliberately set it to `false` to enable control). A blocked call returns code
  `READ_ONLY`.
- A deny-list (`MCP_DENY_TOOLS`) protects named/patterned targets → code `DENIED`.
- A blast-radius cap (`MCP_MAX_BATCH`) refuses oversized batches → code `BLAST_RADIUS_EXCEEDED`.
- Every attempted write is audit-logged.

**Approving a destructive operation.**

- **MCP, elicitation-capable client:** the server prompts the human directly; you just call the
  tool and relay the outcome. If declined you get `APPROVAL_DECLINED`.
- **MCP, no elicitation:** the first call returns `CONFIRMATION_REQUIRED` with a
  `confirm_token`. Show the user the exact impact, get their go-ahead, then **re-invoke the same
  tool with `confirm_token` set** to that token. The token is bound to the specific target set —
  do not reuse it for a different target.
- **CLI:** destructive subcommands require `--yes`. Without it the CLI refuses. Only pass
  `--yes` after the user has explicitly approved that specific action.

Default to caution: when a request is ambiguous about whether it mutates state, prefer the
read-only tool first, summarize what you found, and confirm before any write.

## Tool & command map

`PrefixedID` values (container/VM/disk/notification ids) come from the corresponding `list`/
`status` call — always list first to obtain a valid id.

### System & health

| Intent                  | MCP tool                   | CLI |
| ----------------------- | --------------------------- | --- |
| Is the API reachable?   | `unraid_connection_health`  | `unraid health` |
| Static system info      | `unraid_system_info`        | `unraid system info` |
| Live CPU/memory metrics | `unraid_system_metrics`     | `unraid system metrics` |

### Array, parity & disks

| Intent                       | MCP tool                                             | CLI |
| ----------------------------- | ------------------------------------------------------ | --- |
| Array state + member disks   | `unraid_array_status`                                  | `unraid array status` |
| Past parity checks           | `unraid_parity_history`                                | `unraid array parity-history` |
| List physical disks          | `unraid_list_disks`                                    | `unraid disks list` |
| Start / stop the array 🔴    | `unraid_array_set_state`                                | `unraid array start --yes` / `unraid array stop --yes` |
| Add / remove a disk 🔴       | `unraid_array_add_disk` / `unraid_array_remove_disk`    | `unraid array add-disk <id> --yes` / `unraid array remove-disk <id> --yes` |
| Mount / unmount a disk 🔴    | `unraid_array_mount_disk` / `unraid_array_unmount_disk` | `unraid array mount-disk <id> --yes` / `unraid array unmount-disk <id> --yes` |
| Start a parity check 🔴      | `unraid_parity_start` (`correct: true` writes to parity)| `unraid parity start [--correct] --yes` |
| Cancel a parity check 🔴     | `unraid_parity_cancel`                                  | `unraid parity cancel --yes` |
| Pause / resume parity check  | `unraid_parity_pause` / `unraid_parity_resume`          | `unraid parity pause` / `unraid parity resume` |

### Docker containers

| Intent                        | MCP tool                          | CLI |
| ------------------------------ | ------------------------------------ | --- |
| List containers               | `unraid_list_containers`           | `unraid docker containers` |
| Inspect one container         | `unraid_get_container`             | `unraid docker container <id>` |
| Recent logs                   | `unraid_container_logs`            | `unraid docker logs <id>` |
| Per-container update status   | `unraid_container_update_statuses` | `unraid docker update-status` |
| Start/stop/pause/unpause      | `unraid_docker_start` / `_stop` / `_pause` / `_unpause` | `unraid docker <action> <id>` |
| Pull latest image & recreate  | `unraid_docker_update`             | `unraid docker update <id>` |
| Update all with updates       | `unraid_docker_update_all`         | `unraid docker update-all` |
| Remove a container 🔴         | `unraid_docker_remove` (`withImage` also deletes the image) | `unraid docker remove <id> [--with-image] --yes` |

### Virtual machines

| Intent                          | MCP tool                                                | CLI |
| --------------------------------- | ---------------------------------------------------------- | --- |
| List VMs + run state             | `unraid_list_vms`                                          | `unraid vm list` |
| Start/stop/pause/resume          | `unraid_vm_start` / `unraid_vm_stop` / `unraid_vm_pause` / `unraid_vm_resume` | `unraid vm start <id>` / `unraid vm stop <id>` / `unraid vm pause <id>` / `unraid vm resume <id>` |
| Reboot / force-stop / hard-reset 🔴 | `unraid_vm_reboot` / `unraid_vm_force_stop` / `unraid_vm_reset` | `unraid vm reboot <id> --yes` / `unraid vm force-stop <id> --yes` / `unraid vm reset <id> --yes` |

### Shares, UPS & notifications

| Intent                          | MCP tool                        | CLI |
| ---------------------------------- | ---------------------------------- | --- |
| List user shares                 | `unraid_list_shares`               | `unraid shares list` |
| UPS battery/power telemetry      | `unraid_ups_status`                | `unraid ups status` |
| Notification counts by severity  | `unraid_notifications_overview`    | `unraid notifications overview` |
| List notifications               | `unraid_list_notifications` (queue `UNREAD`/`ARCHIVE`, optional severity) | `unraid notifications list` |
| Create a notification            | `unraid_create_notification`       | `unraid notifications create` |
| Archive / unarchive              | `unraid_archive_notification` / `unraid_unarchive_notification` | `unraid notifications archive <id>` / `unraid notifications unarchive <id>` |

🔴 = destructive — gated by human approval (see the safety model).

## Common recipes

- **"Is my server healthy?"** → `unraid_connection_health`, then
  `unraid_notifications_overview` (any alerts?), `unraid_array_status` (state + disk health
  colors + parity), and `unraid_system_metrics` (CPU/memory). Summarize; flag anything red.
- **"Any containers need updates?"** → `unraid_container_update_statuses`; list the ones at
  `UPDATE_AVAILABLE`. To apply, use `unraid_docker_update <id>` (safe write) per container, or
  `unraid_docker_update_all`.
- **"Restart <container>"** → `unraid_list_containers` to find the id → `unraid_docker_stop`
  then `unraid_docker_start` (both safe writes).
- **"Stop the array"** → destructive: explain it takes shares and all Docker/VMs offline, get
  explicit approval, then `unraid_array_set_state` (with approval/`confirm_token`) or
  `unraid array stop --yes`.
- **Paging:** list/status tools accept `limit`/`offset`; CLI mirrors with `--limit`/`--offset`.

## Reading results

Every operation returns a discriminated envelope:

```json
{ "success": true,  "data": { ... }, "error": null }
{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "..." } }
```

On `success: false`, report the `error.code` and `message` to the user — these are structured
and expected (e.g. `NOT_FOUND`, `READ_ONLY`, `DENIED`, `CONFIRMATION_REQUIRED`,
`APPROVAL_DECLINED`, `BLAST_RADIUS_EXCEEDED`, connection/auth errors). Do not retry a write that
was refused by policy; instead explain what the user must change (e.g. unset `MCP_READ_ONLY`).

## Diagnosing and recovering from a hung web UI

If the Unraid web UI is unresponsive but SSH works, suspect **D-state I/O saturation** rather
than a crashed service. Diagnose over SSH (`ssh root@<host>`) since `unraid_*` tools and the
`unraid` CLI both depend on the same GraphQL API the hung UI uses, and may be unreachable too.

### Diagnosis chain (each step's output picks the next step)

1. **Triage basics:** `uptime; free -m; df -h /var/log / /boot` — rules out a full log
   partition, shows load average and memory pressure.
2. **Count and classify D-states:** `ps -eo pid,state,wchan:32,comm | awk '$2=="D"'`. The
   `wchan` is the tell: `blk_mq_get_tag` = a block device's request queue is saturated (waiting
   for a free tag); a btrfs lock function (e.g. `btrfs_tree_lock_nested`) = a lock convoy backed
   up behind it.
3. **Find the saturated device:** `cat /sys/block/{sd*,loop*,nvme*}/inflight` — **include loop
   devices**; a loop device pinned near its queue-depth cap while physical disks look calm
   points at a loopback-backed image (commonly `docker.img`/`libvirt.img`).
4. **Map loop → backing file:** `losetup -a` to find the backing file (e.g.
   `/mnt/diskN/system/docker/docker.img`), then map the array slot to a physical disk via
   `/var/local/emhttp/disks.ini`.
5. **Dead disk vs saturated disk:** take two `grep ' <dev> ' /proc/diskstats` samples a few
   seconds apart. Progressing counters mean the disk is saturated, not failed.
6. **Find the readers.** No `iotop` on Unraid; sample `/proc/[0-9]*/io` `read_bytes` twice and
   diff:
   ```sh
   for p in /proc/[0-9]*; do echo "$(basename "$p") $(awk '/read_bytes/{print $2}' "$p"/io 2>/dev/null)"; done > /tmp/io1
   sleep 5   # then repeat into /tmp/io2
   join /tmp/io1 /tmp/io2 | awk '{d=$3-$2; if(d>0) print d, $1}' | sort -rn | head
   ```
   A monitoring/logging stack (metrics collector, log shipper, dashboard) doing continuous reads
   is a common culprit.
7. **Why the UI specifically hangs:** the web server's worker processes (e.g. php-fpm) can sit
   in a lock-wait state (`locks_lock_inode_wait`) — a flock convoy where one request holds a
   state-file lock while blocked on the slow disk, queuing every other UI request behind it. The
   login page may still return 200 slowly; authenticated pages never render.
8. **Rule out red herrings:** ZFS ARC size (`/proc/spl/kstat/zfs/arcstats`), btrfs
   scrub/balance in progress (`btrfs scrub status <mountpoint>`).

### Recovery sequence (when the `docker`/`virsh` CLI itself is hung)

1. **`kill -STOP <pids>` the top readers — freeze, don't kill.** Works when `docker stop` can't
   (the docker CLI is blocked on the same saturated filesystem). Reversible, holds no restart
   tripwire, loses nothing — D-state processes absorb the STOP when their current syscall
   returns.
2. **Map a frozen PID to its container without docker:**
   `grep -o 'docker[/-][0-9a-f]\{64\}' /proc/<pid>/cgroup` then
   `jq -r .Name /var/lib/docker/containers/<cid>/config.v2.json`.
3. **Free RAM to stop the thrash.** If a VM is consuming memory that would otherwise back the
   page cache, stopping it (`virsh destroy <vm>`, with user approval — this is a destructive
   operation) can restore enough page cache to let reads absorb again.
4. **Once docker/virsh responds:** `kill -CONT` the frozen PIDs, then `docker stop` them (CONT
   first so SIGTERM can be handled — a STOPped process only dies to a follow-up SIGKILL). Stop
   calls may need a long timeout while the backlog drains; a "context canceled" error just means
   the CLI gave up — retry.
5. **Verify:** load average back to baseline, D-state count near zero, the saturated device's
   `inflight` counters at 0/0, login page latency back to normal.

### Prevention

- **Keep `docker.img`/`libvirt.img` on a cache SSD pool, never on array spinning disks.**
  Migrating them off an array disk requires disabling Docker/VM services, setting the backing
  share cache-only, and moving the file disk-to-disk (`/mnt/diskN/...` → `/mnt/cache/...`) —
  never mixing `/mnt/user` and `/mnt/diskX` paths for the same file. **Trap:** a share already
  set to cache-only does **not** retroactively migrate a pre-existing array-resident image;
  mover skips cache-only shares, so an image created before the setting stays stranded on a
  spinning disk while the UI config looks correct.
- **Budget VM memory** so a healthy margin stays available for page cache — a page cache large
  enough to absorb your monitoring/logging stack's read appetite is what hides a slow backing
  disk in the common case.
- Restart heavy observability stacks only after confirming the backing store is fast; a cold
  cache + a spinning-disk image is what turns background monitoring load into a hang.
- **Unraid's Docker-tab autostart list resurrects a container whenever the Docker service is
  re-enabled, regardless of the container's own restart policy** — to keep a manually-stopped
  container down across a service restart, its Unraid autostart toggle must be off too.
