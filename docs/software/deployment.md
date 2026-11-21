# StudyPilot 部署文档

本文档说明如何将本项目（FastAPI 后端 + React 外壳内嵌静态前端 + PostgreSQL 16）用 Docker Compose 部署到阿里云 Linux 服务器（以 Ubuntu 22.04 为例，ECS 与轻量应用服务器均适用），并提供上线前、中、后的检查单。内容按本项目实际文件（`Dockerfile`、`compose.yaml`、`backend/`、`frontend/`）与本次真实部署过程编写。

> 本系统是**课程演示与个人使用**形态：单机部署、无高可用、无多副本、无队列。上线前必须修改默认数据库口令，并确认每个使用者有自己的模型 API Key（系统按账号加密保存，部署级环境变量不驱动 Agent）。系统中的能力评估、推荐与排程结果均为辅助建议，不能作为学业、招聘等高风险决策的唯一依据。

---

## 一、部署架构

```
用户浏览器 ──HTTP/HTTPS──> Nginx (80/443，可选)
                             └── / ──> 127.0.0.1:8000 (web 容器，uvicorn)
                                             │
                        ┌────────────────────┼──────────────────────────┐
                        │                    │                          │
              PostgreSQL 16（db 容器）   外部模型 API            命名卷 attachments
              卷 studypilot_pgdata    DeepSeek / 通义 / OpenAI   附件 + .model-encryption.key
              单表 records（JSON）    （HTTPS 出网）             │
                                                          宿主机 ./logs（分级日志）
```

与参考文档（海上风电运维智能体）的关键差异，影响部署决策：

| 项目 | 说明 |
|---|---|
| 运行时 | **全部在容器里**。服务器不需要安装 Python、Node.js、PostgreSQL；只有 Docker Engine + Compose V2 |
| 前后端 | **前端在镜像内构建**：`Dockerfile` 先用 `node:22-alpine` 执行 `npm run build`，运行镜像只带 `python:3.12-slim` + `frontend/dist`。服务器上不需要 Node |
| 数据库 | 容器内 **PostgreSQL 16**，数据在命名卷；业务数据是单表 `records`（`owner` + `kind` + JSON），不是 42 张关系表。演示规模下增长很慢 |
| 配置读取 | `.env` 由 compose 注入为容器环境变量；`.env` 已被 `.dockerignore` 与 `.gitignore` 排除，不会进镜像或仓库 |
| 模型 Key | **每个账号在页面里自配**，后端用 Fernet 加密存库（密钥文件默认落在附件卷 `/app/uploads/.model-encryption.key`）。部署级 `MODEL_API_KEY` 只影响 `/api/health` 的展示，不参与 Agent 调用 |
| 长连接 | **没有 WebSocket / SSE**，全部是普通 HTTP 请求；反向代理无需特殊配置，只需放宽读超时 |
| 后台作业 | 无定时任务、无队列、无多进程；`CMD` 中未指定 `--workers`，uvicorn 单进程 |
| 健康检查 | `GET /api/health` **会真实执行一次数据库查询**；compose 已配置 5 s 间隔、20 次重试、10 s 启动宽限 |
| 日志 | `backend/logging.json`：级别 `WARNING`，关闭访问日志，同时输出到 stderr 与 `/app/logs/`，5 MB × 3 份轮转 |
| 资源 | 本机实测后端进程私有内存约 110 MB、峰值约 132 MB（Windows、SQLite、空闲）；容器运行态估 150–300 MB，PostgreSQL 空闲估 40–80 MB。**构建时峰值 2–3 GB**，是唯一需要关注的时刻 |

---

## 二、服务器规格与容量

**规格建议**

| 场景 | CPU | 内存 | 磁盘 | 说明 |
|---|---|---|---|---|
| 课程演示 / 单人使用 | 2 核 | 4 GB | 40 GB ESSD | 本次实测配置，运行宽松 |
| 多人试用（≤10 人） | 2 核 | 4 GB | 40 GB ESSD | 瓶颈在模型调用耗时，不在服务器 |
| 构建机（临时） | 2 核 | 2 GB | 20 GB | 必须加 swap，否则构建会被 OOM 杀掉 |

**为什么是 4 GB**：`docker build` 时会同时跑前端 `npm run build` 与后端 `pip install`，峰值内存 2–3 GB。2 GB 机器必须加 2–4 GB swap；4 GB 机器加 swap 更稳（本次已加 4 GB）。

**磁盘容量估算**（按本项目实际数据形态）：

| 项目 | 占用 | 说明 |
|---|---|---|
| 三个基础镜像 + 应用镜像 | 约 1.2–1.8 GB | `postgres:16-alpine`、`node:22-alpine`、`python:3.12-slim`、`studypilot-web` |
| 构建缓存 | 0–3 GB | 可用 `docker builder prune` 清理 |
| 数据库卷 | 起步几 MB | 单表 JSON，单用户一年的业务数据量级在 MB |
| 附件卷 | 随上传增长 | 单文件上限 10 MB（应用侧限制） |
| 日志 | 最多约 30 MB | 5 MB × 3 × 2 个文件 |

**带宽**：页面与 API 流量很小；真正的流量在构建时下载依赖（约 300–600 MB）。建议按流量计费、峰值 10 Mbps，或固定带宽 3 Mbps 起步。

---

## 三、服务器环境准备

```bash
# 1. 基础软件与时区
sudo apt-get update && sudo apt-get install -y curl ca-certificates gnupg unzip tar tzdata
sudo ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime

# 2. DNS 自检（阿里云 ECS 常见问题：resolv.conf 只指向 127.0.0.53 且解析服务异常）
getent hosts mirrors.aliyun.com || echo "DNS 异常，需要处理"

# 3. 安装 Docker（用阿里云 docker-ce 源；get.docker.com 在国内常被重置）
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker --version && docker compose version       # 需要 Compose V2

# 4. 镜像加速（地址在「容器镜像服务 → 镜像工具 → 镜像加速器」获取）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": ["https://<你的ID>.mirror.aliyuncs.com"]
}
EOF
sudo systemctl restart docker

# 5. 小内存机型加 swap（构建用）
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

### 目录与数据卷规划

```bash
sudo mkdir -p /opt/studypilot/{logs,backup}
```

| 路径/卷 | 内容 | 备份 |
|---|---|---|
| `/opt/studypilot` | 代码、`compose.yaml`、`.env`、`logs/` | 代码可重传；`.env` 必须保留 |
| docker 卷 `studypilot_pgdata` | PostgreSQL 数据 | 必须备份 |
| docker 卷 `studypilot_attachments` | 用户附件 + 模型密钥加密文件 | 必须备份（含 `.model-encryption.key`） |

**卷名前缀来自 `COMPOSE_PROJECT_NAME=studypilot`**，不是代码目录名。备份/恢复命令必须使用 `studypilot_pgdata` / `studypilot_attachments`。

### 安全组（轻量为「防火墙」，ECS 为「安全组」）

| 协议 | 端口 | 授权对象 | 说明 |
|---|---|---|---|
| TCP | 22 | 你的出口 IP | SSH；用 `0.0.0.0/0` 便于演示但风险更高 |
| TCP | 8000 | 0.0.0.0/0 | 直接 IP 访问（演示）；用 Nginx 后可关闭 |
| TCP | 80 / 443 | 0.0.0.0/0 | 仅在使用域名 + HTTPS 时需要 |

**不要**放行 5432（数据库只在 compose 内网）。

---

## 四、部署步骤

### 1. 获取代码


```powershell
# 本机：打包（生成 deploy\dist\studypilot-deploy-<时间戳>.tgz）
powershell -ExecutionPolicy Bypass -File .\deploy\package.ps1

# 本机：上传代码包与一键脚本
scp -o StrictHostKeyChecking=accept-new .\deploy\dist\studypilot-deploy-<时间戳>.tgz root@<公网IP>:/opt/
scp -o StrictHostKeyChecking=accept-new .\deploy\finish-deploy.sh root@<公网IP>:/opt/
```

> 必须用 `.tgz` 而不是 `.zip`：PowerShell 的 `Compress-Archive` 用反斜杠做路径分隔符，Linux 解压后文件名会带 `\`，导致 `compose.yaml` 找不到。

服务器上也可直接 `git clone -b develop <repo>`；国内建议用 Gitee 镜像。

### 2. 配置环境变量

`finish-deploy.sh` 会自动从 `.env.example` 生成 `.env` 并写入随机 `POSTGRES_PASSWORD`；手工部署时：

```bash
cd /opt/studypilot
cp .env.example .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)|" .env
chmod 600 .env
```

必改与可选：

| 变量 | 必填 | 说明 |
|---|---|---|
| `POSTGRES_PASSWORD` | **是** | 同时被 compose 拼进 `DATABASE_URL`；改动后需与已有数据卷一致 |
| `TAVILY_API_KEY` | 否 | 个性化推荐的联网检索；不填则推荐不使用外部资料 |
| `MODEL_*` | 否 | 仅作用户未配置时的兜底展示；**Agent 使用每账号自配的 Key** |

> `.env` 中不要写任何真实模型 Key；用户 Key 走页面配置并加密存储。

### 3. 初始化数据库

本项目不需要手工建库建表：容器启动时 PostgreSQL 自动初始化，应用启动时执行 `Base.metadata.create_all(engine)` 建表。

```bash
cd /opt/studypilot
docker compose up -d db
docker compose exec -T db psql -U studypilot -c 'select 1'      # 能返回即正常
```

说明：

- **没有数据库迁移工具**。`create_all` 只新建缺失的表，不会修改已有表；跨版本升级前必须备份，结构变更需人工处理（当前是单表 JSON，风险较低）。
- 数据保存在卷 `studypilot_pgdata`；`docker compose down` 不会删除它，`down -v` 会。

### 4. Docker Compose 托管

```bash
cd /opt/studypilot
mkdir -p logs
export COMPOSE_PROJECT_NAME=studypilot
docker compose up -d --build --wait --wait-timeout 900
```

关于运行方式（已按 `Dockerfile` 与 `compose.yaml` 核对）：

> - **单进程**：`CMD` 是 `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --log-level warning --no-access-log --log-config backend/logging.json`，未指定 `--workers`。应用内有基于进程内存的状态（会话查询、模型配置 ContextVar），**不建议加多 worker**。
> - **自启**：compose 两个服务均为 `restart: unless-stopped`，服务器重启后自动拉起（前提是 Docker 服务已 `enable`）。
> - **健康检查**：web 服务用 Python `urllib` 请求 `/api/health`，db 服务用 `pg_isready`；`--wait` 会等到两者 healthy 才返回。
> - **端口**：镜像里默认 `127.0.0.1:8000:8000`（只有本机能访问）。仅用 IP 演示时改为 `0.0.0.0:8000:8000` 后 `docker compose up -d`；使用 Nginx 时保持 `127.0.0.1`。

验证：

```bash
docker compose ps
curl -s http://127.0.0.1:8000/api/health
# {"status":"ok","agent":"offline","model":null,"database":"postgresql"}
```

### 5. Nginx 配置

使用域名与 HTTPS 时（仅 IP 演示可跳过）：

```nginx
# /etc/nginx/conf.d/studypilot.conf
server {
    listen 80;
    server_name studypilot.example.cn;

    client_max_body_size 12m;        # 应用侧附件上限 10 MB，留余量

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;     # Agent 调用模型可能较慢
        proxy_send_timeout 120s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

要点（均来自本项目行为）：

- **无 WebSocket / SSE**，因此不需要升级头与关闭缓冲；漏配这些不会导致功能异常。
- **读超时**：`POST /api/agent` 是同步请求，模型调用受 `ChatOpenAI(timeout=45, max_retries=1)` 限制，单次最坏约 90 秒，加上工具轮次会更久；`proxy_read_timeout` 不能低于 120 秒，否则前端会看到 504。
- **附件大小**：应用 `POST /api/files` 限制 10 MB；Nginx 默认 1 MB，不调整会先被 413 拦掉。
- **静态资源**：`frontend/dist` 由 FastAPI 的 `StaticFiles` 托管，中间件对 `.html/.css/.js` 加 `Cache-Control: no-store`，无需额外缓存配置。

### 6. HTTPS 与防火墙

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d studypilot.example.cn

# 仅开放 SSH / HTTP / HTTPS；8000 由安全组控制，不对公网
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

中国大陆节点使用域名对外提供 Web 服务，必须先完成 **ICP 备案**；备案期间可先用 `http://<公网IP>:8000`（无 HTTPS，登录 Cookie 为明文传输，仅限演示）。

---

## 五、发布检查单

### A. 发布准备检查

**版本和范围**
- [ ] 已确认发布版本（记录部署包时间戳或 `git rev-parse HEAD`）
- [ ] 已确认本次变更范围，关联需求或 Issue
- [ ] 已明确本次演示/验收的时间与负责人
- [ ] 已通知参与演示的同学，约定的访问地址

**代码和构建**
- [ ] 本地 `deploy/package.ps1` 打包成功，产物约 15 MB
- [ ] `backend/requirements.txt` 未引入未验证的新依赖
- [ ] 后端测试通过：`PYTHONPATH=./.runtime pytest tests -q`（基线 59 passed）
- [ ] 已确认本次是否改动 `compose.yaml`（端口、卷、环境变量）
- [ ] 已确认本次是否改动数据库结构（本项目无迁移工具，需人工处理）

### B. 配置检查

- [ ] `.env` 已创建，权限 `600`
- [ ] `POSTGRES_PASSWORD` 不是示例值 `local-study-password`
- [ ] `.env` 中没有真实模型 Key（Key 由用户在页面配置）
- [ ] 服务器可访问模型服务：`curl -sI https://api.deepseek.com`
- [ ] 时区为 `Asia/Shanghai`（`date` 命令确认）
- [ ] `MODEL_ENCRYPTION_KEY_FILE` 指向附件卷（compose 默认 `/app/uploads/.model-encryption.key`）
- [ ] `.env` 已被 `.dockerignore`/`.gitignore` 排除（本项目已配置）
- [ ] 仅用 IP 演示时，`compose.yaml` 端口为 `0.0.0.0:8000:8000`

### C. 数据库检查

本项目的业务数据全部在 PostgreSQL 容器中，**数据库是部署中最重要的一环**。

- [ ] `docker compose ps` 中 db 为 `healthy`
- [ ] 能执行 `docker compose exec -T db psql -U studypilot -c 'select 1'`
- [ ] 已备份并验证文件非空：
      `docker compose exec -T db pg_dump -U studypilot studypilot > backup/base.sql`
- [ ] 附件卷存在：`docker volume ls | grep studypilot_attachments`
- [ ] 已确认卷名（`studypilot_pgdata`），避免备份/恢复命令写错
- [ ] 磁盘剩余 ≥ 20%
- [ ] 已规划备份策略（每日逻辑备份 + 保留 7 天）

备份与恢复命令（已按本项目卷名编写）：

```bash
cd /opt/studypilot
STAMP=$(date +%F_%H%M)

# 逻辑备份数据库
docker compose exec -T db pg_dump -U studypilot studypilot > "backup/db_${STAMP}.sql"

# 打包附件卷（含模型加密密钥，必须一起备份）
docker run --rm -v studypilot_attachments:/data -v "$PWD/backup":/backup \
  alpine tar czf "/backup/attachments_${STAMP}.tgz" -C /data .

# 恢复（先停 web，避免写入）
docker compose stop web
cat backup/db_2026-11-21_1200.sql | docker compose exec -T db psql -U studypilot studypilot
docker compose start web
```

### D. 基础设施检查

- [ ] 服务器规格 ≥ 2 核 4 GB（2 GB 必须加 swap）
- [ ] Docker 与 Compose V2 可用，`docker info` 正常
- [ ] 镜像加速器已配置：`docker info | grep -A2 'Registry Mirrors'`
- [ ] DNS 正常：`getent hosts mirrors.aliyun.com`
- [ ] 安全组放行 22 与 8000（或 80/443）
- [ ] 系统时间同步：`timedatectl`
- [ ] 磁盘：`df -h /`，剩余 ≥ 20%

### E. 发布执行检查

- [ ] 先备份（见 C 节）
- [ ] `docker compose up -d --build --wait --wait-timeout 900` 成功
- [ ] `docker compose ps` 两个服务均为 `healthy`
- [ ] 失败时已查看 `docker compose logs --tail 100 web db`

### F. 发布验证检查

- [ ] `/api/health` 返回 `{"status":"ok",...,"database":"postgresql"}`
- [ ] 浏览器可打开 `http://<公网IP>:8000`（或域名）
- [ ] `/docs` 可访问
- [ ] 注册 → 登录成功
- [ ] 个人空间 → 模型 API 设置 → 填 Key → 测试连接成功
- [ ] 生成一次候选，确认「只产出候选、不自动写库」
- [ ] 新建任务后刷新，数据仍在
- [ ] `/opt/studypilot/logs` 下有 `server.warning.log`、`server.error.log`

### G. 发布完成检查

- [ ] 记录本次部署版本（tgz 时间戳 / commit）到 `backup/RELEASES.md`
- [ ] 备份已加入 crontab（见第六章）
- [ ] 云盘自动快照策略已开启
- [ ] 存活探测与告警已配置
- [ ] 回滚材料齐备：`.env` 备份、最近一次 `pg_dump`、上一版部署包

---

## 六、运维手册

### 健康检查与监控

```bash
curl -s http://127.0.0.1:8000/api/health     # 应用 + 数据库
docker compose ps                            # 容器状态
docker stats --no-stream                     # 内存/CPU
free -h && df -h /                           # 内存与磁盘
```

| 监控项 | 方式 | 建议阈值 |
|---|---|---|
| 应用存活 | 每 5 分钟 `curl /api/health` | 连续 3 次失败告警 |
| 容器重启 | `docker compose ps` 的 Restart 列 | 出现即排查 |
| 磁盘 | `df -h /` | > 80% 告警 |
| 内存 | `free -h` | 持续 > 85% 考虑升配 |
| 错误日志 | `logs/server.error.log` | 出现新 ERROR 即关注 |

```bash
# 存活探测（cron）
*/5 * * * * curl -fsS --max-time 5 http://127.0.0.1:8000/api/health >/dev/null || echo "studypilot down $(date)" >> /var/log/studypilot-alert.log
```

### 日志与审计

- 容器日志同时写 stdout 与 `/app/logs/`（`backend/logging.json`），级别固定 `WARNING`，**访问日志关闭**；
- 分级文件：`logs/server.warning.log`、`logs/server.error.log`，5 MB × 3 份自动轮转；
- 需要排查具体请求时：`docker compose logs --tail 200 web`；
- 业务侧记录在数据库 `records` 表，按 `owner` 隔离；系统没有独立审计日志表。

### 容量维护

```bash
df -h && du -sh /var/lib/docker
docker system df                 # 镜像/容器/卷占用
docker image prune -f            # 清理无用镜像（不动卷）
docker builder prune -f          # 清理构建缓存
```

清理对象主要是旧备份与构建缓存；业务数据增长很慢。

### 停止服务

```bash
docker compose stop        # 停止容器，数据保留
docker compose start       # 恢复
docker compose restart web # 只重启应用
docker compose down        # 删除容器，保留卷
docker compose down -v     # 连卷一起删，数据全丢（生产禁用）
```

---

## 七、上线前的账号与数据处理

1. **默认口令**：`POSTGRES_PASSWORD` 示例值必须替换；数据库只在 compose 内网，但弱口令仍有风险。
2. **没有内置账号体系**：系统没有角色/管理员概念，每个账号数据按 `owner` 隔离。演示前自行注册一个账号即可，第一个注册的账号没有特殊权限。
3. **模型 Key**：
   - 每个账号在「个人空间 → 模型 API 设置」配置，后端用 Fernet 加密存库；
   - 加密密钥文件默认在附件卷内（`.model-encryption.key`），**丢失则所有用户需重填 Key**；
   - 迁移服务器时必须随附件卷一起带走。
4. **演示数据**：演示结束后可删除测试账号的相关记录，或重建卷：
   `docker compose down -v && docker compose up -d --build --wait`（⚠ 清空全部业务数据）。
5. **隐私**：用户上传的附件与证据正文保存在附件卷与数据库中，交付演示环境时应告知使用者；系统没有账号注销与数据导出功能。

---

## 八、内网与离线部署

**离线服务器（不能上网）**

```bash
# 有网机器上构建并导出（镜像名以 compose 生成的实际名称为准）
docker compose build
docker save studypilot-web:latest postgres:16-alpine -o studypilot-images.tar

# 传到离线服务器
scp studypilot-images.tar root@<IP>:/opt/
docker load -i /opt/studypilot-images.tar

# 离线启动（不重新构建）
cd /opt/studypilot && docker compose up -d --no-build --wait --wait-timeout 300
```

**构建加速（能上网但慢）**

```dockerfile
# 前端阶段，RUN npm install 之前
RUN npm config set registry https://registry.npmmirror.com
# 后端阶段
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt
```

**拉不到基础镜像时**：从公共镜像站拉取后打回官方 tag，compose 与 build 就会直接用本地镜像：

```bash
docker pull docker.m.daocloud.io/library/postgres:16-alpine
docker tag  docker.m.daocloud.io/library/postgres:16-alpine postgres:16-alpine
# node:22-alpine、python:3.12-slim 同理
```

**模型 API 出网**：容器需要访问模型服务（HTTPS）。只能经代理出网时，在 compose 的 `web` 服务下加：

```yaml
environment:
  HTTPS_PROXY: http://<代理地址>:<端口>
  HTTP_PROXY: http://<代理地址>:<端口>
```

**改用 RDS**：删掉 `db` 服务与 `depends_on`，把 `DATABASE_URL` 指向 RDS 内网地址（`postgresql+psycopg://...`），并重新执行 C 节的备份策略（RDS 自带备份可替代逻辑备份）。

---

## 九、回滚方案

```bash
cd /opt/studypilot

# 1. 回滚代码：重新上传上一版部署包，用更新脚本替换
scp studypilot-deploy-<旧时间戳>.tgz root@<IP>:/opt/
ssh root@<IP> "bash /opt/update-deploy.sh /opt/studypilot-deploy-<旧时间戳>.tgz"

# 2. 若新版本写入了不兼容数据，回滚数据库（谨慎，会丢失备份后的数据）
docker compose stop web
cat backup/before-update-<时间>.sql | docker compose exec -T db psql -U studypilot studypilot
docker compose start web

# 3. 验证
curl -s http://127.0.0.1:8000/api/health
```

要点：

- **不要用首次部署脚本做更新**：首次脚本会重建目录并重新生成 `.env`（随机数据库密码），而数据库卷里仍是旧密码，应用会连不上库；
- 更新请用 `update-deploy.sh`，它会保留 `.env`、自动备份数据库、并重新应用「国内源」与「端口绑定」补丁；
- 因为没有迁移机制，跨版本升级前必须备份；回滚数据库前确认影响范围。

---

## 十、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `curl: (35) ... get.docker.com:443` | 国内访问 get.docker.com 被重置 | 改用阿里云 docker-ce 源安装（第三节第 3 步） |
| `lookup https on 127.0.0.53:53: server misbehaving` | `daemon.json` 地址重复协议；且 DNS 只指向 systemd-resolved 桩地址 | 修正 `daemon.json`；必要时把 `resolv.conf` 改为 `100.100.2.136/138`、`223.5.5.5` |
| `docker.io/library/postgres:16-alpine: not found` | 阿里云加速器对 Docker Hub 代理失效 | 用公共镜像站拉取后 `docker tag` 回官方名（第八节） |
| 构建时 pip 下载只有十几 kB/s | 未使用 PyPI 国内源 | Dockerfile 换 `mirrors.aliyun.com/pypi` |
| `failed to receive status: rpc error: ... EOF` | 构建内存不足被 OOM 杀掉 | 加 2–4 GB swap，或用 4 GB 以上机型 |
| 构建卡在 `Pulling` | 基础镜像拉不下来 | 配镜像加速器，或按第八节预拉取并打 tag |
| 容器 healthy 但浏览器打不开 | `compose.yaml` 端口为 `127.0.0.1`；或安全组未放行 8000 | 改 `0.0.0.0:8000:8000`；放行安全组 |
| `scp: ... No such file or directory` | 本地文件名或路径写错 | 确认 `deploy/dist` 下的实际文件名 |
| 密码提示处连续 `Permission denied` | 中文输入法导致全角字符，或大小写错误 | 切英文输入法重输；仍失败则控制台重置密码并**重启实例** |
| 更新后打不开 | 新包的 `compose.yaml` 覆盖回 `127.0.0.1` | 用 `update-deploy.sh`（会自动重打端口补丁） |
| Agent 提示“请先配置模型 API” | 未在页面配置 Key（环境变量 Key 不驱动 Agent） | 注册 → 个人空间 → 模型 API 设置 |
| 上传附件返回 413 | 前置 Nginx 默认 1 MB | `client_max_body_size 12m` |
| `logs/` 目录为空 | 没有 warning/error 级事件 | 正常现象；用 `docker compose logs` 看 stdout |
| 用户 Key 全部失效 | `.model-encryption.key` 丢失 | 从附件卷备份恢复，或让用户重填 |

---

## 十一、最终发布检查卡

```
□ 服务器 2C4G / Ubuntu 22.04 / 40 GB                        □ 安全组 22 + 8000 已放行
□ .env 已生成且权限 600，口令非示例值                        □ Dockerfile 已换国内源
□ swap 已开启（构建必需）                                   □ 三个基础镜像已在本地
□ docker compose ps 两个服务 healthy                        □ /api/health 返回 database: postgresql
□ compose 端口为 0.0.0.0:8000:8000（仅 IP 演示时）           □ 浏览器能打开并完成注册
□ 模型 Key 已配置且测试连接通过                              □ 生成候选不会自动写库
□ logs/ 下已产生日志文件                                    □ 备份命令跑通且文件非空
□ 已记录本次部署版本                                        □ 答辩前完成一次完整演练与录屏
```
