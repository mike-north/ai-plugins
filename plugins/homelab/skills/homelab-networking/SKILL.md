---
schemaVersion: 0.1.0
name: homelab-networking
description: "Use when local homelab DNS names won't resolve consistently (works with dig, fails in apps; works at home, fails away), when a homelab service needs to be reachable from anywhere via a mesh VPN, or when internal TLS certs (e.g. from a private step-ca) need to be issued, renewed, or diagnosed for a reverse proxy or an Unraid web UI. Covers Tailscale split DNS + subnet routing and step-ca cert renewal/automation."
---

# Homelab networking: mesh-VPN DNS/access and internal TLS

## Making local DNS names resolve everywhere (home + mesh VPN) with remote access

**Problem shape:** internal services use local DNS names served by a home gateway/router (e.g.
`*.<your.local.domain>` → `<LAN-DNS-IP>`). Two common failures:

1. **When the mesh VPN (e.g. Tailscale) is connected, the names stop resolving in apps** — `dig`
   returns the right IP but `ping`/`curl`/browsers say "Unknown host." The VPN's own DNS
   resolver becomes primary, and relying on its fallback-to-system-DNS for the local domain is
   flaky on the OS resolver path (works via `dig`, fails via apps using `getaddrinfo`).
2. **Away from home nothing works at all** — the DNS server and the service IPs are private LAN
   addresses, unreachable off-LAN.

### 1. Split DNS (fixes resolution in both states)

In the VPN's admin console: DNS → add a custom nameserver pointing at `<LAN-DNS-IP>`, restricted
to your local domain. This gives the local domain a real routing resolver (instead of the VPN's
best-effort fallback), so `getaddrinfo` reliably sends `*.<your.local.domain>` through the VPN
to the LAN DNS server. Verify on a client:

```bash
tailscale dns status | grep -A3 'Split DNS Routes'        # <domain> -> <LAN-DNS-IP>
dscacheutil -q host -a name host.<your.local.domain>      # app-path resolution
```

When the VPN is off, the gateway's DHCP already serves the LAN DNS + search domain natively.

### 2. Subnet router (makes the LAN reachable from anywhere)

Run the VPN client natively on an always-on LAN host (not the router/gateway itself — see
gotchas) and advertise the LAN subnet:

```bash
sysctl -w net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1
tailscale set --advertise-routes=<lan-cidr>          # e.g. 10.0.0.0/24
```

Then in the admin console: approve the advertised route for that machine, disable key expiry on
it (an expired node key silently kills the route while you may be away and not notice), and on
clients enable accept-routes (`tailscale set --accept-routes`).

Verify a route is actually approved from a client:

```bash
tailscale status --json | python3 -c '
import json,sys
for p in (json.load(sys.stdin).get("Peer",{}) or {}).values():
    if (p.get("HostName") or "").lower()=="<router-host>":
        print("PrimaryRoutes:", p.get("PrimaryRoutes"))   # e.g. ["10.0.0.0/24"] = approved
'
```

Result: away from home, `*.<your.local.domain>` lookups and service connections both tunnel
through the subnet router — same names, same TLS certs, no per-trip config changes. At home the
VPN won't route a subnet you're physically on, so traffic stays direct.

### Gotchas

- **`dig` works but apps don't** = a primary-resolver or stale-cache issue, not a DNS-data
  problem. After fixing config, clear the macOS negative cache properly — the `dscacheutil` half
  alone does not clear the resolver daemon's record cache:
  ```bash
  sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
  ```
- **Short/bare hostnames can't give short HTTPS URLs.** A name with a dot in it (e.g.
  `service.s`) is queried as-is under default `ndots` behavior and never gets the search domain
  appended. Even if it resolved, the browser validates TLS against the exact typed hostname — a
  search domain can never shorten an HTTPS URL; only a cert SAN for the short name can.
- **Most consumer gateway/router firmware doesn't run a mesh-VPN client natively.**
  Community add-ons exist for some but firmware updates tend to wipe them — use a real
  always-on host (e.g. the NAS/server) as the subnet router instead.
- **Verify actual reachability before trusting a host as subnet router**, especially with
  macvlan/bridged container networking — a Docker host can sometimes not reach its own
  macvlan-networked containers. `ping` a service's container IP from the candidate router host
  first.
- **Failure modes when the subnet router goes down:** VPN hostnames to *other* machines keep
  working (mesh DNS is independent of home infra); only the local-domain split-DNS route (when
  away) and the LAN path are lost. For HA, run a second native subnet router advertising the
  same route — most mesh VPNs auto-fail-over between routers for the same prefix.
- **Persistence:** if the VPN runs as a NAS/Unraid plugin, confirm the advertised route is
  listed in the plugin's own config (not just the running daemon state) so it survives reboots.

## Internal TLS: auto-renewing certs from a private CA (e.g. step-ca)

**Problem shape:** internal services behind a reverse proxy (e.g. nginx-proxy-manager), plus a
NAS/Unraid web UI, use certs hand-issued by a private ACME-capable CA (e.g. Smallstep step-ca).
Two recurring pains: (1) a "site down by name" symptom that looks like a proxy/cert problem but
is actually DNS, and (2) hand-rotated certs silently drifting toward expiry with no automation.

### Diagnose "site down by name" one layer at a time

A three-layer isolation check, testing each layer independently before assuming the worst:

```bash
# 1. DNS: does the name resolve at all, against the actual resolver?
nslookup <service>.<your.local.domain> <LAN-DNS-IP>
# 2. Proxy/cert edge, DNS bypassed (--resolve forces the right SNI):
curl -sk --resolve <service>.<your.local.domain>:443:<proxy-ip> https://<service>.<your.local.domain>/ -o /dev/null -w '%{http_code}\n'
# 3. Upstream app directly, proxy bypassed:
curl -s -o /dev/null -w '%{http_code}\n' http://<app-host>:<port>
```

A single missing wildcard DNS record (`*.<your.local.domain> -> <proxy-ip>`) at the gateway is a
common root cause — a wildcard means future proxy hosts need no DNS change. **Caveat:** most
lightweight DNS servers (e.g. dnsmasq) negatively cache NXDOMAIN, so a freshly-added record can
still appear to fail for the cache TTL — re-test before concluding the record itself is wrong.

### Auto-renew without the CA admin password

Key insight: `step ca renew` authenticates with the **existing cert+key itself** (mutual TLS) —
it needs no provisioner/admin password and no ACME/DNS/HTTP challenge. Once a cert exists,
renewal is fully non-interactive forever. (Adding an ACME *provisioner* to the CA does need the
admin password, which is a separate secret from the CA-key password — don't confuse them; a
"failed to decrypt JWE: invalid password" error means you have the key password, not the admin
one.)

Renewal job skeleton (run from host cron; `step` lives in the step-ca container):

```bash
# Stage cert+key where the CA container's uid can read them:
cp "$LIVE_CERT" "$WORK/cur.pem"; cp "$LIVE_KEY" "$WORK/key.pem"
chown -R <ca-container-uid>:<ca-container-uid> "$WORK"   # root-owned files = "permission denied"

docker exec step-ca step ca renew --ca-url https://localhost:9000 \
  --root /home/step/certs/root_ca.crt --expires-in 1440h --force \
  --out "$CWORK/new.pem" "$CWORK/cur.pem" "$CWORK/key.pem"
# --expires-in is a no-op unless within the renewal window → idempotent, safe to run weekly.

# step ca renew --out emits leaf+chain; extract just the leaf to avoid a duplicate
# intermediate, then append exactly one intermediate:
openssl x509 -in "$WORK/new.pem" -out "$WORK/leaf.pem"
cat "$WORK/leaf.pem" "$INTERMEDIATE" > "$WORK/fullchain.pem"
# verify, install with a backup, `nginx -t`, then `nginx -s reload` (rollback on failure)
```

`step ca renew` reuses the existing private key, so the key file itself is unchanged across
renewals.

### Unraid web UI custom cert

- A custom cert lives at `/boot/config/ssl/certs/<NAME>_unraid_bundle.pem` (`<NAME>` from
  `/boot/config/ident.cfg`). It's a combined PEM: leaf + intermediate + key. Unraid's nginx
  config points both `ssl_certificate` and `ssl_certificate_key` at it.
- Unraid does not clobber a custom `<NAME>_unraid_bundle.pem`; it only auto-manages a separate
  bundle used for its own remote-access hash hostname. Renewing the custom bundle is safe.
- Reload the host nginx with `nginx -s reload` after replacing the bundle. A bad bundle can't
  lock you out: reload only swaps on a clean parse, otherwise the current cert keeps serving.
  Always `nginx -t` first and keep a backup.

### Scheduling on Unraid's native cron (no extra plugin needed)

Unraid's own cron mechanism concatenates `/boot/config/plugins/dynamix/*.cron` into the system
crontab (stored under `/etc/cron.d`, so plain `crontab -l` shows nothing — use
`crontab -c /etc/cron.d -l`). Files on the `/boot` flash device (FAT) lose the executable bit, so
invoke scripts via `/bin/bash <script>`. The `.cron` file on flash reloads on every boot.

```bash
printf '%s\n' '# weekly' '23 4 * * 0 /bin/bash /boot/config/plugins/<name>/renew.sh >> /var/log/<name>.log 2>&1' \
  > /boot/config/plugins/dynamix/<name>.cron
update_cron
crontab -c /etc/cron.d -l | grep renew   # verify it loaded
```

### Gotchas

- **Forced-renew math:** `step ca renew --expires-in D` is rejected when `D` is at or above the
  cert's total validity, so you cannot force-renew a freshly issued cert (its remaining life is
  ≈ its total). To validate the pipeline right after issuing, pick `D` between the cert's
  remaining life and its total, or just trust the logic and let the real window trigger it
  later.
- **Container file ownership:** if the CA runs as a non-root uid inside its container, staged
  files must be `chown`ed to that uid or renewal fails with "permission denied." A minimal CA
  image may also lack `openssl` — use `step certificate inspect/verify` inside the container, or
  do cert munging on the host instead.
- **Don't double-append the intermediate:** `step ca renew --out` already emits leaf+chain;
  extract just the leaf with `openssl x509` (it returns only the first PEM block) before
  appending your own intermediate.
- **Reused private key:** renewal keeps the same key — don't regenerate it, or you'll break the
  key/cert pairing in a combined bundle.

### Client trust gotcha (Apple): manually-installed root profiles don't auto-trust SSL

**Symptom:** the CA's root is installed via a `.mobileconfig` (a manually-installed, non-MDM
configuration profile), but HTTPS still shows "not trusted." In Keychain the root shows SSL as
unspecified while S/MIME shows "Always Trust" — the tell that macOS granted some policies but
specifically gated SSL.

This is intentional Apple anti-MITM behavior: a root delivered by a manually-installed profile
is added but not automatically trusted for TLS. A human must grant SSL trust explicitly:

- **macOS:** Keychain Access → the root certificate → Trust → **Secure Sockets Layer (SSL): Always
  Trust**.
- **iOS/iPadOS:** Settings → General → About → **Certificate Trust Settings** → toggle the root
  on.

There is no `.mobileconfig` key to force per-policy SSL trust on a manually-installed profile.
Zero-touch SSL trust requires pushing the root via MDM — for a handful of homelab devices, the
one-time per-device toggle is the expected flow; document it on the CA's landing page so it
isn't a surprise.

Trust the **root**, not the leaf or intermediate — the whole chain then validates. The
intermediate does not need to be pre-installed if the server sends it (verify with
`openssl s_client -connect <host>:443 -servername <name> -showcerts` — expect two certs: leaf +
intermediate). Trusting the root is the entire job.

Non-Apple clients (Android/Windows/Linux/Firefox) can't consume a `.mobileconfig` — serve the
raw root as a `.crt`/`.pem` file (e.g. host `root_ca.crt` on the CA's own site) and import it
into the OS or browser trust store directly.
