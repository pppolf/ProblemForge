# 使用 /root/.hydro/Caddyfile 部署

以下命令在 Ubuntu 22.04/24.04 **x86_64 云服务器的 SSH 终端**执行，使用 root 账户，不是在本机 PowerShell 执行。每个代码块单独复制；命令中的 `set -e` 会在出错时停止，可能退出当前 SSH 终端，重新登录后从失败步骤继续。域名 `problems.cwnupaa.com` 应解析到该服务器，80/443 由现有 Caddy 接收。这里部署新站，原 Windows 题库需另行迁移。

## 1. 检查并备份现有 Caddyfile

普通账户先执行 `sudo -i`；已是 root 可以跳过。下面按文件名 `Caddyfile`（大写 C）编写，先确认文件存在：

```bash
set -e
whoami
uname -m
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
ls -l /root/.hydro/Caddyfile
caddy version
cp -a /root/.hydro/Caddyfile "/root/.hydro/Caddyfile.problemforge.$(date +%Y%m%d-%H%M%S).bak"
```

应显示 root、x86_64 和 Caddy 的版本。文件名不同或 Caddy 命令不存在时，先提供该段输出，不能随意复制其他 Caddyfile 替代。

## 2. 准备基础工具与 Docker

```bash
set -e
apt-get update
apt-get install -y git curl ca-certificates xz-utils

if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io docker-compose-v2
  systemctl enable --now docker
fi

docker compose version
docker info --format '{{.OSType}}'
```

最后应显示 Compose v2 版本及 linux。已安装 Docker 时复用现有 Docker；如果已有 Docker 但 Compose 命令缺失，提供报错后按其安装来源补插件，不卸载现有容器环境。

## 3. 安装 ProblemForge 专用 Node / pnpm / PM2

这套工具装在 `/opt/problemforge-tools`，只在本终端通过 PATH 选用，Hydro 现有 Node、PM2 和进程组保持原位置。Node 22.23.3 与首次 GitHub 检查使用的版本一致，压缩包 SHA-256 已与 Node 官方发布清单核对。

```bash
set -e
install -d -m 755 /opt/problemforge-tools
cd /opt/problemforge-tools

curl -fL --retry 3 https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-x64.tar.xz -o node-v22.23.3-linux-x64.tar.xz
printf '%s\n' 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de  node-v22.23.3-linux-x64.tar.xz' | sha256sum -c -
tar --no-same-owner -xJf node-v22.23.3-linux-x64.tar.xz

export PATH="/opt/problemforge-tools/node-v22.23.3-linux-x64/bin:$PATH"
npm install --prefix /opt/problemforge-tools/npm pnpm@10.11.1 pm2@7.0.4 --registry=https://registry.npmjs.org

printf '%s\n' 'export PATH="/opt/problemforge-tools/npm/node_modules/.bin:/opt/problemforge-tools/node-v22.23.3-linux-x64/bin:$PATH"' > /opt/problemforge-tools/env.sh
. /opt/problemforge-tools/env.sh

node -v
pnpm -v
```

应显示 v22.23.3 和 10.11.1。以后重新登录服务器，执行部署/维护前先运行 `. /opt/problemforge-tools/env.sh`。

## 4. 拉取代码并保存私有 APPKEY

```bash
set -e
cd /root
if [ -d /root/ProblemForge/.git ]; then
  git -C /root/ProblemForge pull --ff-only
else
  git clone https://github.com/pppolf/ProblemForge.git /root/ProblemForge
fi
cd /root/ProblemForge
```

下面的配置脚本会保留已有且格式正确的 `/root/problemforge.secrets.json`；文件不存在时，提示输入 APPKEY。先执行这一个代码块，等到输入提示出现，再单独粘贴完整 APPKEY 并回车，暂时不要粘贴下一步的部署命令。输入不显示，实际值不放入命令行历史或 Git：

```bash
cd /root/ProblemForge
. /opt/problemforge-tools/env.sh
bash scripts/configure-cloud-secrets.sh
```

空输入或格式不正确会重新提示，复制时带入的首尾空白会去掉。出现“私有配置已保存”或“私有配置已存在且 APPKEY 格式正确”后，再继续下一步。这里仅检查格式和保存配置，不验证协会接口是否接受该 APPKEY。旧版内联命令若报“APPKEY 格式不正确”，说明未完成本地格式校验，尚未向协会发起请求；重新拉取代码后用此脚本重试，无需重装工具。

## 5. 生成发布目录并部署

可以先单独运行一次只读配置检查；它只读取 Caddyfile 和 Caddy 本机管理接口，不写配置、不重载、不安装应用：

```bash
cd /root/ProblemForge
. /opt/problemforge-tools/env.sh
node scripts/cloud-deploy.mjs check-caddy --settings-file infra/cloud-settings.hydro.json
```

显示“Caddyfile 与运行配置匹配”后，执行：

```bash
set -e
cd /root/ProblemForge
. /opt/problemforge-tools/env.sh

pf_build="git-$(git rev-parse HEAD)"
pf_release="$PWD/.local/releases/cloud-$pf_build/problemforge"
if [ ! -f "$pf_release/cloud-release.json" ]; then
  node scripts/package-cloud.mjs "$pf_build"
fi

bash "$pf_release/deploy.sh" \
  --secrets-file /root/problemforge.secrets.json \
  --settings-file /root/ProblemForge/infra/cloud-settings.hydro.json
```

该配置指定 `/root/.hydro/Caddyfile` 和 `caddy` 重载方式，启动 ProblemForge 专属 PM2 进程组和基础服务。应用健康后，脚本备份并合并该 Caddyfile，只新增本站标记块，用 Caddy CLI 平滑重载。首次构建 TeX/Judge 镜像较慢，看到构建日志时等待完成。脚本最终显示“部署完成”才算成功；预检失败不会自动去改 Hydro 的管理方式。

云端构建默认通过清华 TUNA Debian 镜像下载依赖，TeX 和 Judge 使用各自的 APT 缓存；TeX 的全部包合并安装，避免重复刷新索引和运行格式生成。APT 网络空闲超时为 30 秒、最多重试 3 次；整个镜像构建上限 30 分钟。日志逐行输出，超时或在镜像构建阶段按 Ctrl+C 会取消本次构建进程组，等待其退出后释放部署锁。已有缓存不主动删除，但未完成的安装层可能需要重新下载部分依赖。其他源可在私有 `infra.env` 中指定 `DEBIAN_MIRROR` 和 `DEBIAN_SECURITY_MIRROR`；不修改宿主机的软件源。

如果提示 Caddy 管理接口不可用或运行配置不一致，提供最后的报错，先核对实际 Caddy 启动方式和已保存配置；不要为通过预检停掉所有 PM2 进程。`caddy run` 默认从工作目录读取 `Caddyfile`，其自动生成的 `file_server.hide` 可能记录为 `./Caddyfile`；安装器会分别按绝对路径和同目录文件名适配，选择与运行 JSON 完全一致的方式，并保持该方式重载。如果仍不匹配，会显示最多 8 个差异字段路径，不打印配置值；不会忽略真实路由或隐藏文件规则的差异。

旧版若长时间停在镜像的 `apt-get` 下载阶段，先在该终端按一次 Ctrl+C，等它返回命令提示符，再执行下面的恢复命令。该命令仅在没有未完成数据库迁移、且原部署进程已退出时清理遗留锁；不会停止 Docker、删除缓存或数据卷：

```bash
(
set -e
. /opt/problemforge-tools/env.sh
cd /root/ProblemForge

if [ -f /opt/problemforge/shared/pending-deploy.json ]; then
  printf '%s\n' '存在未完成的数据库迁移，请先用原发布包完成恢复。'
  exit 1
fi

if [ -f /opt/problemforge/.deploy.lock ]; then
  pf_previous_pid="$(cat /opt/problemforge/.deploy.lock)"
  if [[ ! "$pf_previous_pid" =~ ^[1-9][0-9]*$ ]] || kill -0 "$pf_previous_pid" 2>/dev/null; then
    printf '%s\n' '原部署进程仍存在或锁内容异常，请先提供此提示，不继续部署。'
    exit 1
  fi
  rm -- /opt/problemforge/.deploy.lock
fi

git pull --ff-only
pf_build="git-$(git rev-parse HEAD)"
pf_release="$PWD/.local/releases/cloud-$pf_build/problemforge"
if [ ! -f "$pf_release/cloud-release.json" ]; then
  node scripts/package-cloud.mjs "$pf_build"
fi
bash "$pf_release/deploy.sh" \
  --secrets-file /root/problemforge.secrets.json \
  --settings-file /root/ProblemForge/infra/cloud-settings.hydro.json
)
```

## 6. 查看管理员账号并检查网站

```bash
cat /opt/problemforge/shared/bootstrap-admin.txt
. /opt/problemforge-tools/env.sh
bash /opt/problemforge/current/deploy.sh status
```

打开 `https://problems.cwnupaa.com/login?mode=admin`，使用文件中的邮箱、随机密码登录；普通成员使用协会账号。密码只在自己的终端查看即可。

以后升级重复第 4 步的拉取代码和第 5 步。若上一次数据库迁移未完成，先用原版本重试，不能先切换到新提交。查看本项目日志可以运行 `tail -n 80 /opt/problemforge/shared/logs/api.err.log`；不要提供包含私有 JSON 或管理员密码的终端内容。

实际验证范围：部署定向检查现为 14 项，通过；Linux Caddy 2.10.2 实际复现绝对/相对配置路径导致的 hide 差异，并验证选择相对调用后精确匹配、真实配置差异仍拒绝。只读命令使用模拟的管理接口响应通过，不监听端口。此前已完成自定义目录、相对 import、原站点保留及 PM2 启动/重载夹具。没有登录用户云服务器或执行真实 Caddy 重载、Ubuntu 安装和业务任务。Node 归档仅核对官方校验清单，未在本机执行上述服务器安装命令。

依据：[Caddy reload](https://caddyserver.com/docs/command-line#caddy-reload)、[Caddy 管理接口](https://caddyserver.com/docs/api#get-configpath)、[Node 22.23.3 官方校验清单](https://nodejs.org/dist/v22.23.3/SHASUMS256.txt)、[Ubuntu Compose 包](https://packages.ubuntu.com/noble/docker-compose-v2)。
