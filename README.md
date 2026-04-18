# AmnewziaWG Easy

You have found the easiest way to install & manage WireGuard on any Linux host!

<p align="center">
  <img src="./assets/screenshot.png" width="802" />
</p>

## Features

* All-in-one: AmneziaWG + Web UI.
* Easy installation, simple to use.
* List, create, edit, delete, enable & disable clients.
* Show a client's QR code.
* Download a client's configuration file.
* Statistics for which clients are connected.
* Tx/Rx charts for each connected client.
* Gravatar support or random avatars.
* Automatic Light / Dark Mode
* Multilanguage Support
* Traffic Stats (default off)
* One Time Links (default off)
* Client Expiry (default off)
* Prometheus metrics support
* **Multiple WireGuard tunnels** (separate kernel interfaces, e.g. `wg0` + `wg1`): one JSON + `.conf` per interface under `WG_PATH`, optional `WG_TUNNELS` for defaults, Web UI tunnel switcher, and pfSense-style API on all tunnels.

## Requirements

* A host with Docker installed.

When you run the app with **`node server.js` from the `src/` folder**, variables in the **repository root `.env`** are loaded automatically (via `dotenv` in [`src/config.js`](src/config.js)). Docker Compose still uses `env_file: .env` as before; variables set in the shell or compose override the file where they conflict.

## Installation

### 1. Install Docker

If you haven't installed Docker yet, install it by running:

```bash
curl -sSL https://get.docker.com | sh
sudo usermod -aG docker $(whoami)
exit
```

And log in again.

### 2. Run AmneziaWG Easy

**From this repository (no `ghcr.io/w0rng/amnezia-wg-easy` image):** in the repo root, with `.env` filled in, run:

```bash
docker compose up --build -d
```

That builds the local [`Dockerfile`](./Dockerfile) and runs the image tagged **`amnezia-wg-easy:local`** ([`docker-compose.yml`](./docker-compose.yml)). Compose uses **`pull_policy: never`** for that tag so Docker does not try to pull a non-existent `amnezia-wg-easy` repository from Docker Hub. The first build still pulls **base** layers from Docker Hub (**`amneziavpn/amnezia-wg`** and **`node:18-alpine`**) unless they are already cached.

**Apple Silicon (M1/M2/M3):** if you see *“platform (linux/amd64) does not match the host (linux/arm64)”*, Docker resolved the base image to **amd64**. For a native **arm64** build, copy the override once and rebuild:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose build --no-cache && docker compose up -d
```

Compose auto-merges `docker-compose.override.yml`. That file is **gitignored** (only [`docker-compose.override.yml.example`](./docker-compose.override.yml.example) is in the repo) so Mac and **Ubuntu** (or any server) can each keep a local override without committing it. On **x86_64 Linux** (typical Ubuntu VPS), do **not** copy the example—use [`docker-compose.yml`](./docker-compose.yml) alone so the image matches **amd64**. Only use the override on **Apple Silicon** when you need a native **arm64** build.

**Prebuilt registry image** (`ghcr.io/w0rng/amnezia-wg-easy`): you can still run a published image directly, for example:

```
  docker run -d \
  --name=amnezia-wg-easy \
  -e LANG=en \
  -e WG_HOST=<🚨YOUR_SERVER_IP> \
  -e PASSWORD_HASH=<🚨YOUR_ADMIN_PASSWORD_HASH> \
  -e PORT=51821 \
  -e WG_PORT=51820 \
  -v ~/.amnezia-wg-easy:/etc/wireguard \
  -p 51820:51820/udp \
  -p 51821:51821/tcp \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_MODULE \
  --sysctl="net.ipv4.conf.all.src_valid_mark=1" \
  --sysctl="net.ipv4.ip_forward=1" \
  --device=/dev/net/tun:/dev/net/tun \
  --restart unless-stopped \
  ghcr.io/w0rng/amnezia-wg-easy
```

> 💡 Replace `YOUR_SERVER_IP` with your WAN IP, or a Dynamic DNS hostname.
>
> 💡 Replace `YOUR_ADMIN_PASSWORD_HASH` with a bcrypt password hash to log in on the Web UI.
> See [How_to_generate_an_bcrypt_hash.md](./How_to_generate_an_bcrypt_hash.md) for know how generate the hash.

The Web UI will now be available on `http://0.0.0.0:51821`.

The Prometheus metrics will now be available on `http://0.0.0.0:51821/metrics`. Grafana dashboard [21733](https://grafana.com/grafana/dashboards/21733-wireguard/)

> 💡 Your configuration files will be saved in `~/.amnezia-wg-easy`

## Options

These options can be configured by setting environment variables using `-e KEY="VALUE"` in the `docker run` command.

| Env                           | Default           | Example                        | Description                                                                                                                                                                                                              |
|-------------------------------|-------------------|--------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PORT`                        | `51821`           | `6789`                         | TCP port for Web UI.                                                                                                                                                                                                     |
| `WEBUI_HOST`                  | `0.0.0.0`         | `localhost`                    | IP address web UI binds to.                                                                                                                                                                                              |
| `WWW_PATH`                    | *(auto)*          | `/var/www/wg`                  | Directory of the static Web UI (`index.html`, `js/`, …). Default: next to `lib/Server.js` (`www/` under `src/`). Set this if you run the app from a custom layout.                                                       |
| `PASSWORD_HASH`               | -                 | `$2y$05$Ci...`                 | When set, requires a password when logging in to the Web UI. See [How to generate an bcrypt hash.md]("https://github.com/wg-easy/wg-easy/blob/master/How_to_generate_an_bcrypt_hash.md") for know how generate the hash. |
| `WG_HOST`                     | -                 | `vpn.myserver.com`             | The public hostname of your VPN server.                                                                                                                                                                                  |
| `WG_DEVICE`                   | `eth0`            | `ens6f0`                       | Ethernet device the wireguard traffic should be forwarded through.                                                                                                                                                       |
| `WG_PORT`                     | `51820`           | `12345`                        | Default UDP listen port when a tunnel JSON has no `server.listenPort` (typically `wg0`).                                                                                                                                 |
| `WG_UDP_PORT_RANGE`           | *(unset)*         | `51820-52100`                  | **Docker Compose:** publish a **UDP port range** (`start-end`, same inside the container). If unset, only `WG_PORT` is published. **Also set in `.env` for the app:** new tunnel listen ports must fall in this range (or equal `WG_PORT` when unset), or creation/API/restore fails. Auto-picked ports for new tunnels start at the **range minimum** (not `WG_PORT` when a range is set). `sync_tunnels` / `add_tunnel` pass `listen_port` so new interfaces are created inside the range before defaults run. |
| `WG_TUNNELS`                  | *(empty)*         | `wg0,wg1` or `wg0:51820,wg1:51821` | Optional list of interface names to bring up on start. Names without `:port` get sequential UDP ports starting at `WG_PORT`. Merged with tunnel JSON files found under `WG_PATH`.                                   |
| `WG_CONFIG_PORT`              | `51820`           | `12345`                        | The UDP port used on [Home Assistant Plugin](https://github.com/adriy-be/homeassistant-addons-jdeath/tree/main/wgeasy)                                                                                                   |
| `WG_MTU`                      | `null`            | `1420`                         | The MTU the clients will use. Server uses default WG MTU.                                                                                                                                                                |
| `WG_PERSISTENT_KEEPALIVE`     | `0`               | `25`                           | Value in seconds to keep the "connection" open. If this value is 0, then connections won't be kept alive.                                                                                                                |
| `WG_DEFAULT_ADDRESS`          | `10.8.0.x`        | `10.6.0.x`                     | Clients IP address range.                                                                                                                                                                                                |
| `WG_DEFAULT_DNS`              | `1.1.1.1`         | `8.8.8.8, 8.8.4.4`             | DNS server clients will use. If set to blank value, clients will not use any DNS.                                                                                                                                        |
| `WG_ALLOWED_IPS`              | `0.0.0.0/0, ::/0` | `192.168.15.0/24, 10.0.1.0/24` | Allowed IPs clients will use.                                                                                                                                                                                            |
| `WG_PRE_UP`                   | `...`             | -                              | See [config.js](https://github.com/wg-easy/wg-easy/blob/master/src/config.js#L19) for the default value.                                                                                                                 |
| `WG_POST_UP`                  | `...`             | `iptables ...`                 | Default snippets use `{INTERFACE}`, `{LISTEN_PORT}`, and `{SERVER_SUBNET}` (expanded per tunnel when writing each `.conf`). Override with your own rules if needed.                                                      |
| `WG_PRE_DOWN`                 | `...`             | -                              | See [config.js](https://github.com/wg-easy/wg-easy/blob/master/src/config.js#L27) for the default value.                                                                                                                 |
| `WG_POST_DOWN`                | `...`             | `iptables ...`                 | See [config.js](https://github.com/wg-easy/wg-easy/blob/master/src/config.js#L28) for the default value.                                                                                                                 |
| `WG_ENABLE_EXPIRES_TIME`      | `false`           | `true`                         | Enable expire time for clients                                                                                                                                                                                           |
| `LANG`                        | `en`              | `de`                           | Web UI language (Supports: en, ua, ru, tr, no, pl, fr, de, ca, es, ko, vi, nl, is, pt, chs, cht, it, th, hi).                                                                                                            |
| `UI_TRAFFIC_STATS`            | `false`           | `true`                         | Enable detailed RX / TX client stats in Web UI                                                                                                                                                                           |
| `UI_CHART_TYPE`               | `0`               | `1`                            | UI_CHART_TYPE=0 # Charts disabled, UI_CHART_TYPE=1 # Line chart, UI_CHART_TYPE=2 # Area chart, UI_CHART_TYPE=3 # Bar chart                                                                                               |
| `DICEBEAR_TYPE`               | `false`           | `bottts`                       | see [dicebear types](https://www.dicebear.com/styles/)                                                                                                                                                                   |
| `USE_GRAVATAR`                | `false`           | `true`                         | Use or not GRAVATAR service                                                                                                                                                                                              |
| `WG_ENABLE_ONE_TIME_LINKS`    | `false`           | `true`                         | Enable display and generation of short one time download links (expire after 5 minutes)                                                                                                                                  |
| `MAX_AGE`                     | `0`               | `1440`                         | The maximum age of Web UI sessions in minutes. `0` means that the session will exist until the browser is closed.                                                                                                        |
| `UI_ENABLE_SORT_CLIENTS`      | `false`           | `true`                         | Enable UI sort clients by name                                                                                                                                                                                           |
| `ENABLE_PROMETHEUS_METRICS`   | `false`           | `true`                         | Enable Prometheus metrics `http://0.0.0.0:51821/metrics` and `http://0.0.0.0:51821/metrics/json`                                                                                                                         |
| `PROMETHEUS_METRICS_PASSWORD` | -                 | `$2y$05$Ci...`                 | If set, Basic Auth is required when requesting metrics. See [How to generate an bcrypt hash.md]("https://github.com/wg-easy/wg-easy/blob/master/How_to_generate_an_bcrypt_hash.md") for know how generate the hash.      |
| `AMNEZIA_API_ENABLED`         | `false`           | `true`                         | Enables the pfSense-style JSON management API (`POST /api/compat/amnezia`). Separate from the Web UI password.                                                                                                            |
| `AMNEZIA_API_KEY`             | -                 | `long-random-secret`           | Required when the API is enabled and `AMNEZIA_API_AUTH=apikey`. Send as HTTP header `X-API-Key`.                                                                                                                         |
| `AMNEZIA_API_AUTH`            | `apikey`          | `none`                         | `apikey`: require `X-API-Key`. `none`: no key (insecure; use only on trusted networks).                                                                                                                                   |
| `AMNEZIA_API_BASE_PATH`       | *(empty)*         | `/awg/api`                     | Optional extra mount: `POST` that path (and `POST …/` ) plus `GET …/status`. Default `POST /api/compat/amnezia` always remains. Useful behind reverse proxies that expect a fixed prefix.                                |
| `JC`                          | `random`          | `5`                            | Junk packet count — number of packets with random data that are sent before the start of the session.                                                                                                                    |
| `JMIN`                        | `50`              | `25`                           | Junk packet minimum size — minimum packet size for Junk packet. That is, all randomly generated packets will have a size no smaller than Jmin.                                                                           |
| `JMAX`                        | `1000`            | `250`                          | Junk packet maximum size — maximum size for Junk packets.                                                                                                                                                                |
| `S1`                          | `random`          | `75`                           | Init packet junk size — the size of random data that will be added to the init packet, the size of which is initially fixed.                                                                                             |
| `S2`                          | `random`          | `75`                           | Response packet junk size — the size of random data that will be added to the response packet, the size of which is initially fixed.                                                                                     |
| `H1`                          | `random`          | `1234567891`                   | Init packet magic header — the header of the first byte of the handshake. Must be < uint_max.                                                                                                                            |
| `H2`                          | `random`          | `1234567892`                   | Response packet magic header — header of the first byte of the handshake response. Must be < uint_max.                                                                                                                   |
| `H3`                          | `random`          | `1234567893`                   | Underload packet magic header — UnderLoad packet header. Must be < uint_max.                                                                                                                                             |
| `H4`                          | `random`          | `1234567894`                   | Transport packet magic header — header of the packet of the data packet. Must be < uint_max.                                                                                                                             |

> If you change `WG_PORT`, make sure it still falls inside the **published** UDP range. For **more than one tunnel**, either publish **one host UDP port per tunnel** or set **`WG_UDP_PORT_RANGE`** (e.g. `51820-52100`) so every tunnel `ListenPort` in that range is reachable.

### Multiple tunnels (quick reference)

* **On disk:** `{WG_PATH}/{ifName}.json` and `{ifName}.conf` (e.g. `wg0.json`, `wg1.json`). Legacy installs with only `wg0.json` behave as before.
* **Subnets:** each tunnel should use a **non-overlapping** `/24` (server address drives the client pool, e.g. `10.8.0.1` → clients `10.8.0.x`; a new tunnel picks the next free third octet when created). The server address **must not** end in `.0` or `.255`. **Docker:** the container’s `eth0` is usually in **`172.17.0.0/16`–`172.31.0.0/16`**; do **not** put a tunnel’s `/24` in the same range as `eth0` (e.g. if `eth0` is `172.18.0.2/16`, avoid `172.18.0.0/24` for WireGuard or clients can conflict with the container IP and lose internet).
* **Web UI:** **Tunnels / Peers / Settings** tabs; on **Peers**, a tunnel selector appears when more than one tunnel exists; client API paths are `/api/wireguard/{tunnel}/client/...` (legacy `/api/wireguard/client/...` stays on **`wg0`**).
* **Web UI session API** (same browser session cookie / password gate as other `/api/*` routes, no `X-API-Key`):
  - `GET /api/wireguard/tunnel` — array of tunnel summaries (`name`, `listen_port`, `address`, `peer_count`, Amnezia `config`, …).
  - `POST /api/wireguard/tunnels/sync` — JSON `{ "tunnels": [ … ] }`; each item follows the same tunnel shape as the compat `sync_tunnels` action (see below).
  - `POST /api/wireguard/tunnels/add` — JSON `{ "tunnel": { … }, "overwrite": false }` for add/merge payloads (interface `name`, optional `listenport`, optional `addresses`).
  - `POST /api/wireguard/tunnels/reset` — JSON `{ "tunnel": "wg0" }` to regenerate Amnezia obfuscation parameters for that interface.
  - `DELETE /api/wireguard/tunnels/:tunnel` — remove a tunnel’s on-disk config and interface (cannot delete the **last** remaining tunnel).
  - `GET /api/server-settings` / `PUT /api/server-settings` — read or update **runtime** overrides stored in `{WG_PATH}/wg-easy-server-settings.json` (optional keys: `wgHost`, `wgDefaultDns`, `compatApiEnabled`). Omitted keys follow `.env` (`WG_HOST`, `WG_DEFAULT_DNS`, `AMNEZIA_API_ENABLED`). The **Settings** tab can toggle the pfSense-compatible API and override the public endpoint host and client DNS line without editing the container environment.
* **Backup:** The Web UI downloads **`GET /api/wireguard/backup?tunnel=all`**, a single JSON file with `{ "_format": "...", "tunnels": { "wg0": {...}, "wg1": {...} } }` (one tunnel is still exported in this shape). The API also accepts **`?tunnel=wg0`** (default when omitted) for a single-interface file. Restore via **`PUT /api/wireguard/restore`**; the server detects the multi-tunnel format and restores every listed tunnel.

**Docker / Compose:** map every UDP port WireGuard listens on — either **`-p start-end:start-end/udp`** (see **`WG_UDP_PORT_RANGE`** in [`.env.example`](./.env.example) and [`docker-compose.yml`](./docker-compose.yml)) or separate lines per port, e.g. `-p 51820:51820/udp -p 51821:51821/udp`, plus the Web UI TCP port (`PORT`).

### VPN client won’t connect (Docker on a VPS)

The Web UI can work while WireGuard peers do not — check these in order:

1. **`WG_HOST`** in `.env` must be this server’s **public IPv4** or a **DNS name** that resolves to it (what clients use to reach you). Open the downloaded `.conf` and confirm **`Endpoint = …:port`**. If `WG_HOST` was wrong or a placeholder, fix `.env`, **`docker compose up -d --force-recreate`**, then **delete the old client and create a new one** (or re-download the config) so the Endpoint updates.
2. **UDP port** — each tunnel’s **listen port** must be inside what Docker publishes (`WG_UDP_PORT_RANGE` or the default `WG_PORT` mapping in [`docker-compose.yml`](./docker-compose.yml)) and match the **Endpoint** port in the client. Remap Docker and open the firewall for that port or range.
3. **Cloud firewall** (Vultr, AWS, etc.) — allow **inbound UDP** on that port to the instance. The control panel firewall is separate from `ufw` on the VM.
4. **Host firewall** — e.g. `sudo ufw allow 51820/udp` (adjust to your `WG_PORT`), then `sudo ufw reload`.
5. **On the server**, after a connect attempt:  
   `docker compose exec amnezia-wg-easy wg show wg0`  
   If **latest handshake** stays empty, packets are not reaching WireGuard (wrong IP/port/firewall) or the client uses the wrong Endpoint.
6. **Test from another network** (e.g. phone on LTE) to rule out LAN hairpin/NAT oddities.

`WG_DEVICE=eth0` is correct for the default route **inside** the container; change it only if you know your setup needs another interface.

## pfSense-style external API

The optional compatibility layer mirrors a typical AmneziaWG **pfSense** JSON API: JSON body with an `act` field, JSON responses with optional `data` and `message`, and automation auth via **`X-API-Key`** (not the Web UI bcrypt password). It operates on **real interface names** (`wg0`, `wg1`, …) discovered from `WG_PATH` and `WG_TUNNELS`.

### Model mapping

| pfSense / multi-tunnel | amnezia-wg-easy |
|------------------------|-----------------|
| Multiple tunnels       | One row per interface in `get_tunnels`. Names are Linux interface names (max 15 chars: letters, digits, `_`, `-`). |
| Peers per tunnel       | Each tunnel has its own `clients` map in `{ifName}.json`. `sync_peers` with **`tunnel: "all"`** applies the same peer list to **every** tunnel (each gets addresses from its own pool). |
| `sync_peers`           | Matches peers by **`public_key`**. New peers get an auto-assigned IPv4 from that tunnel’s pool. **`privateKey` is not required** on the server for API-created peers. |
| Listen UDP port        | Per tunnel: `server.listenPort` in JSON, else **`WG_TUNNELS`** / **`WG_PORT`** defaults. `sync_tunnels` / `add_tunnel` can set listen port and server address. |

### Endpoints

- **`GET /api/compat/status`** — Public. Returns `{ enabled, auth, endpoint, statusPath }` (no secrets). `endpoint` / `statusPath` reflect `AMNEZIA_API_BASE_PATH` when set.
- **`POST /api/compat/amnezia`** — JSON body. If `AMNEZIA_API_ENABLED=true` and `AMNEZIA_API_AUTH=apikey`, send header **`X-API-Key: <AMNEZIA_API_KEY>`**.
- If **`AMNEZIA_API_BASE_PATH=/awg/api`** (example): also **`POST /awg/api`**, **`POST /awg/api/`**, and **`GET /awg/api/status`** — same behavior as the `/api/compat/…` routes (so a browser `GET` of the POST-only URL no longer hits the static file handler with 405).

### `act` values

| `act` | Description |
|-------|-------------|
| `get_peers` | List clients in pfSense-like shape (`public_key`, `allowed_ips`, `tunnel` = interface name, …). |
| `get_tunnels` | One summary per tunnel (Amnezia `jc`/`jmin`/…, addresses, `listen_port`). |
| `get_connected_peers` | Per-tunnel blocks with `tunnel`, `peers`, `total_peers`. |
| `sync_peers` | Body: `peers` (array), optional `tunnel` (`all` or a specific interface, e.g. `wg1`). Replaces the client set on the chosen tunnel(s) to match the list (empty `peers` clears). Each peer: `public_key`, `description`, optional `allowed_ips`, optional `enabled`. |
| `sync_peers_all` | Same as `sync_peers` with tunnel `all`. |
| `sync_tunnels` | Body: `tunnels` (array). Each element **`name`** must match the target interface; updates server address and Amnezia parameters from `config` / `address` / `listen_port`. **`address`** may be a **network CIDR** (e.g. `["10.18.0.0/16"]`); the server is stored as the **first host** in that prefix (here `10.18.0.1`). Plain IPv4 without `/` is stored as given. |
| `add_tunnel` | Body: `tunnel` object with **`name`** (interface), optional `overwrite`. If the JSON file already exists and `overwrite` is not `true`, returns an error. |
| `reset_tunnel` | Body: `tunnel` = interface name. Regenerates random Amnezia obfuscation fields for that tunnel. |

### Example

```bash
curl -sS -X POST "http://127.0.0.1:51821/api/compat/amnezia" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_AMNEZIA_API_KEY" \
  -d '{"act":"get_peers"}'
```

### `405 Method Not Allowed` even with POST

That usually means the request **never hit** the compat handler (so it fell through to the static file layer, which only allows GET).

1. **Use the URL the container actually registered** — Extra mounts exist **only if** `AMNEZIA_API_BASE_PATH` is set **inside the running container**. Check:  
   `docker compose exec amnezia-wg-easy printenv AMNEZIA_API_BASE_PATH`  
   If this prints nothing, the variable is missing (common on a fresh server clone without a full `.env`). Copy **[`.env.example`](./.env.example)** to **`.env`**, set **`AMNEZIA_API_BASE_PATH=/awg/api`** (and **`AMNEZIA_API_KEY`**, etc.), then **`docker compose up -d --force-recreate`**.  
   Until then, **`POST /awg/api` does not exist** — use **`POST /api/compat/amnezia`** (always registered) or fix `.env`.
2. **Reverse proxy (nginx, Caddy, Traefik)** — Ensure the location allows **`POST`** (no `limit_except GET` / wrong `proxy_pass` stripping the path). Test the app directly:  
   `curl -X POST http://127.0.0.1:PORT/api/compat/amnezia ...` on the host where Node listens (mapped `PORT`).
3. **Startup log** — With `DEBUG=Server` in the container env, logs include which compat POST paths were registered.

## Updating

**If you run from source** (`docker compose` with local build): pull the latest Git changes, then rebuild and recreate:

```bash
docker compose up --build -d
```

**If you use the prebuilt image** from GHCR:

```bash
docker stop amnezia-wg-easy
docker rm amnezia-wg-easy
docker pull ghcr.io/w0rng/amnezia-wg-easy
```

Then run the `docker run -d \ ...` command above again (or switch your compose file back to `image: ghcr.io/w0rng/amnezia-wg-easy` without `build:`).

## Thanks

Based on [wg-easy](https://github.com/wg-easy/wg-easy) by Emile Nijssen.  
Use integrations with AmneziaWg from [amnezia-wg-easy](https://github.com/spcfox/amnezia-wg-easy) by Viktor Yudov.
