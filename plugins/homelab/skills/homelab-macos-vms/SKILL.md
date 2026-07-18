---
schemaVersion: 0.1.0
name: homelab-macos-vms
description: "Use when running or troubleshooting macOS guests on KVM/QEMU (e.g. via Unraid/libvirt) without GPU passthrough — dead networking, a CPU core pegged 24/7, WindowServer freezes or crash-loops, boot hangs after a vCPU change, settings silently reverting, an unusable web console, or remote-access/clipboard problems over screen sharing."
---

# macOS-on-KVM/QEMU VM gotchas

Running Hackintosh-style macOS VMs on KVM/QEMU (e.g. Unraid, libvirt/virsh; OpenCore, Q35, no
GPU passthrough) surfaces a cluster of non-obvious failures. Each has a specific root cause and
fix. Diagnose host-side over SSH (`virsh`, `ip`, `bridge`) and in-guest over SSH once it's set
up. Replace `<host>`, `<vm>` below with your actual libvirt host/domain names.

## 1. No network / virtio-net dead — NIC must be on the root PCI bus

**Symptom:** the guest emits zero frames. Host-side: `ip -s link show vnetN` shows `RX bytes 0`;
`bridge fdb show | grep <mac>` never learns the MAC. In-guest: `ifconfig -l` shows no `enX` at
all; `networksetup -listallhardwareports` lists no Ethernet.

**Root cause:** macOS only binds its virtio-net driver when the NIC sits on the **root PCI bus**
— `PciRoot(0x0)/Pci(0x3,0x0)` = `bus=0x00 slot=0x03`. A GUI that auto-places NICs behind a
pcie-root-port (`bus=0x01 slot=0x00`) puts the NIC somewhere macOS never enumerates.

**Fix:** edit the libvirt NIC `<address>` to `bus='0x00' slot='0x03' function='0x0'`, then
`virsh define <vm>.xml`, cold boot.

## 2. WindowServer pegged ~96% CPU / animation freezes / sluggish — wrong display device

**Symptom:** one core pegged constantly even when idle; window/genie animations freeze for
minutes; in-guest `top -l 2 -stats command,cpu | grep WindowServer` shows ~96%.

**Root cause:** `<video><model type='qxl'>` — macOS has no QXL driver, so WindowServer
busy-loops on a degraded OVMF-GOP framebuffer.

**Fix:** change the display device to `vmvga` (QEMU `vmware-svga`, which macOS does drive —
appears as vendor `0x15ad`):

```xml
<model type="vmvga" vram="16384" heads="1" primary="yes"/>
```

After reboot, WindowServer drops to idle. Keep resolution at 1080p (not Retina). This is the
fix for the core peg, the freezes, and general sluggishness. If `vmvga` itself crash-loops
WindowServer, first check for an unrelated CPU-starvation cause (item 9) before reverting to
`qxl` — a starved WindowServer can crash under `vmvga` too, and the underlying starvation should
be fixed either way.

## 3. Genie/animation freezes persist even with Reduce Motion enabled

**Root cause:** Accessibility's Reduce Motion does not govern the Dock minimize (genie) effect.

**Fix (per-user, no sudo; for a remote/unaccelerated VM, kill all animation):**

```bash
defaults write com.apple.dock mineffect -string scale
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock expose-animation-duration -float 0
defaults write -g NSAutomaticWindowAnimationsEnabled -bool false
defaults write -g NSWindowResizeTime -float 0.001
defaults write com.apple.finder DisableAllAnimations -bool true
killall Dock; killall Finder
```

## 4. Boot hangs after a vCPU change — avoid odd core counts

**Symptom:** after bumping vCPUs via `<topology cores='3' threads='2'/>`, the VM hangs at early
SMP init: `virsh vcpuinfo <vm>` shows only vCPU0 accumulating time, block I/O stats are
flatlined, no kernel panic.

**Root cause:** macOS dislikes odd physical-core counts (real Macs never have 3 cores).
`cores=2 threads=2` (4 vCPUs) boots fine.

**Fix/Prevention:** prefer even core topologies (e.g. 8 vCPUs as `cores=4 threads=2`). Change
one VM at a time and watch disk I/O during boot — `virsh domstats <vm> --block | grep rd.bytes`
climbing means it's booting; flatlined with a single active vCPU means it's hung → revert from a
backup.

## 5. GUI Form view silently clobbers manual XML edits

**Root cause:** editing a VM via a management GUI's Form view (e.g. Unraid's) regenerates the
domain XML, resetting manual `<address>` and `<video>` overrides — NIC back to `bus=0x01`, video
back to `qxl` — re-breaking items 1 and 2. A VM can appear to keep working only because its
*running* instance predates the clobber; the saved config is already broken and will fail on
next reboot.

**Mitigation:** edit these VMs via XML view only, or install a libvirt `qemu` hook to
re-assert the addresses at start. vCPU count survives GUI edits (it's a form field); PCI
addresses and the video model do not. After any GUI edit, re-verify NIC bus and video model.

## 6. Web VNC console drops Shift (mangles capitals/symbols)

**Root cause:** a known noVNC↔QEMU keysym-translation defect (`|`→`\`, `"`→`'`, capitals lost) —
not a guest problem.

**Fix:** stop using the web console for input. Set up SSH and operate over a real shell.
Bootstrap from a client that has a working keyboard: `ssh-copy-id -i ~/.ssh/<key>.pub
<user>@<vm-host-or-ip>` — reach the guest via mDNS (`<hostname>.local`) or, across subnets, via
a mesh VPN (e.g. Tailscale MagicDNS; see the networking skill). Native macOS Screen Sharing
(classic RFB) also has correct keyboard handling, unlike a web VNC console — but see item 15
before using Apple's own Screen Sharing client.

## 7. Auto-login doesn't fire after a forced/unclean shutdown

**Symptom:** login screen instead of desktop on boot, despite auto-login configured and
FileVault off (`fdesetup status`).

**Root cause:** macOS deliberately skips auto-login after an improper shutdown. It works on
clean boots — verify with `stat -f%Su /dev/console` (should be the logged-in user, not
`root`/`_windowserver`).

## 8. Remote access pattern that works

Native macOS Screen Sharing over a mesh VPN (put the VMs, client, and host on the same overlay
network) gives full keyboard/clipboard and routes across subnets without web-VNC keymap pain.
The web console becomes a recovery-only channel. **Power-recovery chain:** UPS → host boot →
array/storage online → VM autostart (`virsh autostart <vm>`) → macOS auto-login (FileVault off)
→ mesh VPN reconnect (a LaunchAgent that opens the VPN client at login) → Screen Sharing
reachable. See the networking skill for the mesh-VPN setup, and item 15 below before using
Apple's Screen Sharing client specifically.

## 9. apsd (Apple Push daemon) runs away and starves WindowServer

**Symptom:** a background push daemon consumes sustained high CPU with no obvious cause;
WindowServer becomes starved — it can crash-loop (`Abort trap: 6`), load spikes far above core
count, the GUI session freezes at login, and auto-login stops firing.

**Diagnose runaway CPU with `top -l 2 -o cpu`** — not `-l 1`, whose first sample is a 0%
artifact. **Signature to remember: load 60+ with most memory free = blocked-process pileup
behind a starved/crashing WindowServer, not a memory problem.**

**Fix (persistent, notifications aren't useful on a headless VM):**

```bash
sudo launchctl disable system/com.apple.apsd
sudo launchctl bootout system/com.apple.apsd
```

## 10. Spotlight reindex + Time Machine cause an I/O storm that starves WindowServer

**Symptom:** load average 100+ while actual CPU usage is near-idle (top consumer is your own
shell) — an I/O-wait pileup, not a CPU problem. On qcow2-backed VMs, the post-boot Spotlight
reindex plus Time Machine backup hammer the virtual disk; WindowServer gets starved and can
restart shortly after auto-login, bouncing the session back to the login window.

**Fix (persistent):**

```bash
sudo mdutil -a -i off   # disable Spotlight indexing
sudo tmutil disable     # disable Time Machine
```

**Tradeoff:** Spotlight content search stops working (filename search still works); re-enable
and let it index once while the VM is otherwise idle if needed. Don't strip demand-driven
daemons (iCloud sync, Find My, Siri, etc.) chasing this — they're near-zero cost at idle and
often matter for what the VM is used for. The I/O storm was the actual lever, not idle daemons.

## 11. Login window renders black over Screen Sharing (and won't accept input)

**Symptom:** with the `vmvga` display device, the *pre-login* screen renders black over screen
sharing and keystrokes (including a blind-typed password) do nothing. The desktop itself renders
fine once logged in — only the pre-login state is broken.

**Implication:** a `vmvga` VM must auto-login and never sit at the login window. If it gets
stuck at a black login screen, recover via a VM temporarily set to `qxl` (which does render the
login window over screen sharing) or via the hypervisor's local/web console framebuffer (subject
to item 6's Shift-key defect). Auto-login itself can be flaky — it reliably fires on a
reboot-from-logged-in-session but often skips on a reboot-from-login-window state, and
re-arming it needs the password typed locally (not doable over SSH). Recovery from a
login-window bounce is one manual local login, then keep the session alive (disable
screensaver/sleep as in item 12's spirit, so it doesn't happen again).

## 12. Screensaver/lock screen doesn't reliably accept keystrokes over remote screen sharing

**Root cause:** a secure-input quirk in macOS's lock-screen path. If a headless VM's screensaver
auto-locks, you can see the screen but typing the password may not register — a real risk of
lockout on a box with no physical console access.

**Fix (disable for headless VMs managed only remotely):**

```bash
defaults -currentHost write com.apple.screensaver idleTime 0
defaults -currentHost write com.apple.screensaver askForPassword 0
sudo pmset -a displaysleep 0 sleep 0
```

## 13. Apple Screen Sharing.app crashes WindowServer on GPU-less VMs — use a classic RFB client instead

**This is the big one.** On a VM with no GPU passthrough, connecting with Apple's own **Screen
Sharing.app** (the modern client, macOS 26+) deterministically crashes WindowServer within a
few seconds of connecting: `Abort trap: 6`, an assertion in the software-GL compositor path
(the modern capture pipeline can't run against a software framebuffer). WindowServer's death
force-logs-out the session. This happens with **both** `vmvga` and `qxl`, and VRAM size does not
prevent it (though a larger VRAM, e.g. 128MB, does survive some non-Screen-Sharing I/O storms
that a smaller one wouldn't — keep VRAM generous regardless).

**Consequences this produces, that can be misdiagnosed as something else:** "black screen on
connect," "sessions randomly log out," "clipboard never works" (the process hosting the
pasteboard for the session dies with WindowServer), "screen goes black even in the local/web
console" (WindowServer is actually dead, not just the remote view).

**Fix:** never connect to these VMs with Apple's Screen Sharing.app — and don't leave saved
connections in it, since its window-restore behavior can auto-reconnect unattended and kill a
session nobody is using. Quit the app fully and delete any saved entries for these VMs. Use a
**classic RFB client** (e.g. a third-party VNC viewer that speaks the legacy protocol) instead —
sessions survive indefinitely under it.

## 14. Clipboard sync over classic RFB is effectively gutted on modern macOS guests

**Symptom:** a classic-RFB screen-sharing session (the safe alternative from item 13) has a
dead clipboard channel against a modern macOS guest's `screensharingd` — auto-sync, focus-trigger
sync, and explicit get/send-clipboard commands all no-op.

**Working alternative:** a small manual pull/push clipboard bridge over SSH (e.g. a script
that runs `pbcopy`/`pbpaste` on the guest via a persistent SSH ControlMaster connection from the
client, either invoked manually or as an auto-sync poll daemon). This is pasteboard-level, so it
works regardless of how the copy happened, and can be wrapped in a LaunchAgent for
transparent copy/paste during a session. Note: `pbcopy`/`pbpaste` on the guest require a
logged-in GUI session (the pasteboard daemon) — they silently no-op or return empty at the login
window.

## Prevention checklist

- **NIC `<address>`** on `bus=0x00 slot=0x03`.
- **`<video>` model `vmvga`** (not `qxl`), generous VRAM (e.g. 128MB).
- **Even vCPU core topology.**
- **Edit via XML only** on any host GUI that has a Form-view clobber hazard; re-verify NIC +
  video after any GUI-mediated edit.
- **Keep backups** of the domain XML before any change.
- **Manage over SSH or a classic RFB client — never a web VNC console for input, never Apple's
  Screen Sharing.app for GPU-less VMs.**
- **Disable apsd, Spotlight indexing, and Time Machine** on headless/remotely-managed VMs to
  avoid the WindowServer-starvation failure modes above.
- **Disable screensaver/display-sleep** on VMs with no physical console access.
- **For any boot-affecting change:** one VM at a time, watch block I/O stats to distinguish
  booting from hung, keep a one-command revert ready.
- **Verify recovery on a clean reboot** (not a force-stop): `stat -f%Su /dev/console` is the
  logged-in user, the mesh VPN has reconnected, and remote screen sharing is reachable.
