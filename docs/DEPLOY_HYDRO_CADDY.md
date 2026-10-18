# 使用 /root/.hydro/Caddyfile 部署

以下命令在 Ubuntu 22.04/24.04 **x86_64 云服务器的 SSH 终端**执行，使用 root 账户，不是在本机 PowerShell 执行。每个代码块单独复制；命令中的 `set -e` 会在出错时停止，可能退出当前 SSH 终端，重新登录后从失败步骤继续。域名 `problems.cwnupaa.com` 应解析到该服务器，80/443 由现有 Caddy 接收。这里部署新站，原 Windows 题库需另行迁移。

已有站点只需在服务器源码目录拉取代码，然后运行 `bash deploy.sh update`，见文末「更新已有站点」。以下编号步骤用于首次安装。

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

### 数据库 P1001 且实际端口映射为 null

PostgreSQL 日志显示监听 5432、容器 healthy，但 Prisma 无法连接 127.0.0.1:25432，并且 inspect 显示配置端口存在、实际端口为 null，说明旧包的 internal-only 网络没有建立宿主机映射。5432 是容器内部端口，25432 是本站指定宿主机端口；不应改连服务器原有的其他 PostgreSQL 服务。

先在**云服务器**读取监听及本站容器信息：

```bash
ss -lntp '( sport = :5432 or sport = :5181 or sport = :25432 or sport = :26379 or sport = :25050 or sport = :25051 )'
docker ps -a --filter label=com.docker.compose.project=problemforge-cloud --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

下面拉取仅用于获取新的恢复工具。`resume-network` 从 pending 锁定原应用包，不执行新包打包或升级；保留原数据库、Redis、密钥与已构建的 TeX/Judge 镜像。工具会先自动核对端口与服务归属，有冲突就停止，不会停止其他服务或更换端口。

```bash
(
set -e
. /opt/problemforge-tools/env.sh
cd /root/ProblemForge
git pull --ff-only
node scripts/cloud-deploy.mjs resume-network
)
```

它只补接 `problemforge-cloud` 四个基础服务的宿主机访问网络，不重启 Docker 或服务器。实际回环映射和应用用户 TCP 连接检查通过后，继续同一版本的部署，包括既有的本站 PM2、Caddy 合并及 HTTPS 验证。原 Caddy 配置仍须完整匹配才会合并本站域名。看到“部署完成”才进入下一步；若出现冲突、锁或其他报错，保留提示和 pending，不清卷或删除 pending。

### Caddy 报 caddy.listeners.layer4 未注册

该错误说明此次用于读取配置的 Caddy 可执行程序没有注册配置需要的 `caddy.listeners.layer4` 模块。部署器当前通过 PATH 的 `command -v caddy` 查找程序，再解析符号链接；它可能与正在监听 80/443 的程序不同，也可能是当前文件配置与运行配置不一致，不能只凭版本号确定。`caddy list-modules` 用于列出当前可执行程序中的模块，见 [官方命令说明](https://caddyserver.com/docs/command-line#caddy-list-modules)。

先在云服务器 root 终端执行以下只读诊断，保留现有配置和运行进程。这里只打印命令路径、监听归属、进程及模块名，不输出私有环境变量或完整 Caddyfile，不重载、安装或重启服务。

```bash
(
. /opt/problemforge-tools/env.sh
type -a caddy
pf_caddy_cli="$(sh -c 'command -v caddy')"
printf '部署器使用的程序：%s\n' "$pf_caddy_cli"
readlink -f "$pf_caddy_cli"
"$pf_caddy_cli" version
"$pf_caddy_cli" list-modules | grep -Fx 'caddy.listeners.layer4' || true

ss -lntp '( sport = :80 or sport = :443 or sport = :2019 )'
ps -eo pid,comm,args | grep '[c]addy'
for pf_pid in $(pgrep -x 'caddy|caddy-l4' || true); do
  printf '\n运行中的 Caddy PID=%s\n' "$pf_pid"
  readlink "/proc/$pf_pid/exe"
  "/proc/$pf_pid/exe" version
  "/proc/$pf_pid/exe" list-modules | grep -Fx 'caddy.listeners.layer4' || true
done
)
```

保留并提供完整输出。若正在运行的程序包含该模块而 PATH 程序不包含，后续应让本项目部署命令使用已核实的现有程序；若二者均缺失或找不到运行进程，需要继续核对配置来源和实际监听者，不能猜测正确路径。进程枚举没有结果也要保留前面的 ps/ss 输出。不要通过删除现有 layer4 配置、直接下载替换全局 Caddy 或升级模块来绕过检查；这些会改变共用服务器上的其他服务。当前错误在 Caddy 适配/预检处产生，本次命令尚未进入部署器的应用停机和数据库迁移阶段；不据此推断此前命令或服务器其他任务的状态。

2026-10-15 用户回传确认：80/443/2019 均由 PID 1380 的 `caddy-l4` 监听，启动命令为 `/usr/local/bin/caddy-l4 run --config /root/.hydro/Caddyfile --adapter caddyfile`，而 PATH 的 caddy 指向无 layer4 模块的 Nix 2.10.2。这时可为 ProblemForge 专用工具目录设置 caddy 入口，兼容现有已部署版本，不需要改已发布应用源码或全局 Caddy。以下命令先核对监听和实际模块，只创建本项目的符号链接并备份/补充本项目 env.sh；不会修改 Caddyfile、替换 `/usr/local/bin/caddy-l4` 或重启原 Caddy。

```bash
(
set -euo pipefail
test "$(id -u)" = 0
test -d /opt/problemforge-tools
test ! -L /opt/problemforge-tools
test -f /opt/problemforge-tools/env.sh
test ! -L /opt/problemforge-tools/env.sh
test -x /usr/local/bin/caddy-l4

ss -lntp '( sport = :80 or sport = :443 or sport = :2019 )'
/usr/local/bin/caddy-l4 list-modules | grep -Fx 'caddy.listeners.layer4'

test ! -L /opt/problemforge-tools/bin
install -d -m 755 /opt/problemforge-tools/bin
if [ -e /opt/problemforge-tools/bin/caddy ] || [ -L /opt/problemforge-tools/bin/caddy ]; then
  test "$(readlink -f /opt/problemforge-tools/bin/caddy)" = "$(readlink -f /usr/local/bin/caddy-l4)"
else
  ln -s /usr/local/bin/caddy-l4 /opt/problemforge-tools/bin/caddy
fi

pf_path_line='export PATH="/opt/problemforge-tools/bin:$PATH"'
if ! grep -Fxq "$pf_path_line" /opt/problemforge-tools/env.sh; then
  cp -a /opt/problemforge-tools/env.sh "/opt/problemforge-tools/env.sh.before-caddy-l4-$(date +%Y%m%d-%H%M%S)"
  printf '\n%s\n' "$pf_path_line" >> /opt/problemforge-tools/env.sh
fi

. /opt/problemforge-tools/env.sh
pf_selected_caddy="$(sh -c 'command -v caddy')"
readlink -f "$pf_selected_caddy"
test "$(readlink -f "$pf_selected_caddy")" = "$(readlink -f /usr/local/bin/caddy-l4)"
node /opt/problemforge/current/scripts/cloud-deploy.mjs check-caddy
bash /opt/problemforge/current/deploy.sh status
)
```

模块检查应打印 `caddy.listeners.layer4`，选中的真实路径应与 `/usr/local/bin/caddy-l4` 的真实路径一致，随后 Caddy 配置匹配和原站状态检查应通过。发现专用入口已有不同目标时命令会停止，不覆盖。路径补充保存在 env.sh，括号子 shell 退出或重新登录后，原升级步骤中的 `. /opt/problemforge-tools/env.sh` 仍会选择正确程序。完成后使用文末的更新命令；任一步报错先处理该错误。此处成功仅表示原站预检通过，不表示新版应用已部署。

### Caddy 管理接口返回 HTTP 403

2026-10-15 用户确认专用入口已选中 `/usr/local/bin/caddy-l4`，且目标模块存在，下一步只读 `check-caddy` 返回 403。`Unnecessary header_up` 是配置适配警告，当前阻塞发生在读取管理接口时。

旧部署器读取 `/config/` 时缺少 `Origin` 请求头，启用 `enforce_origin` 的 Caddy 会拒绝该请求。新版按 [Caddy 官方 CLI](https://github.com/caddyserver/caddy/blob/v2.10.2/cmd/commandfuncs.go#L622-L668) 的做法，发送管理接口自身的 Origin，例如 `http://localhost:2019`；保留回环地址限制、禁止重定向、完整运行配置比对和错误时停止的行为。无需修改现有 Caddy 安全配置。仅凭状态码还不能确认服务器的具体拒绝原因，以新版只读检查的结果为准。

先按下文 A 在本机推送已提交的修复；再在服务器运行以下块。这里使用拉取后源码中的部署器执行 `check-caddy` 和 `status`，因为 `/opt/problemforge/current` 中的旧部署器尚未更新；不要修改旧发布目录的源码或清单。`status` 支持从源码调用，无需先生成发布包。

```bash
(
set -euo pipefail
. /opt/problemforge-tools/env.sh
test "$(id -u)" = 0
test -f /opt/problemforge/.problemforge-managed
test ! -e /opt/problemforge/shared/pending-deploy.json
test ! -e /opt/problemforge/.deploy.lock
ss -lntp '( sport = :80 or sport = :443 or sport = :2019 or sport = :5181 or sport = :25432 or sport = :26379 or sport = :25050 or sport = :25051 )'
cd /root/ProblemForge
test "$(git branch --show-current)" = master
test -z "$(git status --porcelain)"
git pull --ff-only origin master
git log -1 --oneline
node scripts/cloud-deploy.mjs check-caddy
node scripts/cloud-deploy.mjs status
)
```

确认监听归属仍为原 Caddy 和本站托管资源；归属异常或上述命令报错即停止。两项检查成功后继续下文 D 备份并部署新固定版本，再执行 E 验收。新版正式激活后，`current/deploy.sh status` 才会使用修复后的部署器。如果仍是 403，保留报错进一步核对管理接口 Host / Origin 限制，不关闭校验或跳过运行配置比较，也不要输出完整 `/config/` 响应。

### API 启动报 Cannot find package 'tsx'

如果 ProblemForge API 在线数检查失败，并在日志看到 `Cannot find package 'tsx' imported from /opt/problemforge/`，原因是旧配置从 PM2 守护进程目录解析预加载器；已安装的依赖实际位于固定发布目录。这不是要求在 `/opt/problemforge` 或全局重新安装 tsx。新版恢复工具使用发布目录的绝对加载路径，并先以服务用户核验可加载性。

仍有 pending 时，在云服务器执行上面的 `git pull --ff-only` 与 `node scripts/cloud-deploy.mjs resume-network` 整段命令即可；保留当前应用版本、镜像和数据库，只重新生成本站 PM2 启动配置并继续部署。该命令始终限定 problemforge 用户及 `/opt/problemforge/shared/pm2`，不会调用 root 的 `/root/.pm2` 去停止或升级既有服务。用户当前 root PM2 v6.0.14 与本站 PM2 v7.0.4 分别运行，看到不同进程列表是预期行为。

### 绝对路径的 tsx/dist/loader.mjs 仍报模块不存在

2026-10-15 用户部署 `git-5142c4e6bd9e92bf672d84527076c7bba0806ca1` 时，在 prepare 的服务账号预加载检查报上述错误。此处在沙箱构建、停止原应用和迁移之前；该次命令尚未开始切换站点。不要与上一小节的裸包名解析问题混淆。

已在 Linux 复现本轮指引的 `umask 077` 和旧部署器权限处理组合：发布目录可能是 0700，文件是 0600；旧代码改属主为 root 后，仅撤去组写入和其他用户权限，没有授予 problemforge 组读取/目录访问权限，导致 root 能读取实际存在的 loader，而服务账号报 ERR_MODULE_NOT_FOUND。新版在新目录和 `.prepared` 重试两条路径都明确设置 `g+rX,g-w,o-rwx`，并在写入 ready 标记前以实际服务用户预加载。`X` 仅给目录或原本可执行的文件增加执行/访问权限，见 [GNU chmod 说明](https://www.gnu.org/software/coreutils/manual/html_node/Conditional-Executability.html)。

下列命令专用于用户此次尚未激活的固定版本。先确认托管标记、真实目录、root 可读 loader、目录属组和包哈希；获得本项目部署锁后再次检查 current/pending，仅修正该目录权限，然后释放锁并重试原包。原包源码、清单和依赖字节不变，不需为此次恢复先推送新代码。若文件真的缺失、目录归属异常、已有 pending/锁或该版本已经激活，命令停止，应提供检查输出再判断，不套用权限修复。

```bash
(
set -euo pipefail
umask 077
. /opt/problemforge-tools/env.sh
test "$(id -u)" = 0
cd /opt/problemforge
test -f .problemforge-managed
pf_release=/opt/problemforge/releases/git-5142c4e6bd9e92bf672d84527076c7bba0806ca1
pf_loader="$pf_release/node_modules/tsx/dist/loader.mjs"
pf_node="$(readlink -f "$(command -v node)")"
test "$(readlink -f "$pf_release")" = "$pf_release"
test -f "$pf_release/.prepared"
namei -l "$pf_loader"
test -r "$pf_loader"
test "$(stat -c '%U:%G' "$pf_release")" = root:problemforge

pf_lock=/opt/problemforge/.deploy.lock
pf_lock_pid=$BASHPID
( set -o noclobber; printf '%s\n' "$pf_lock_pid" > "$pf_lock" )
trap 'rm -f -- "$pf_lock"' EXIT
test ! -e /opt/problemforge/shared/pending-deploy.json
test -L /opt/problemforge/current
test "$(readlink -f /opt/problemforge/current)" != "$pf_release"
ss -lntp '( sport = :80 or sport = :443 or sport = :2019 or sport = :5181 or sport = :25432 or sport = :26379 or sport = :25050 or sport = :25051 )'

node --input-type=module - "$pf_release" <<'NODE'
import { pathToFileURL } from 'node:url';
const directory = process.argv[2];
const { verifyRelease } = await import(pathToFileURL(`${directory}/scripts/cloud-config.mjs`).href);
const manifest = await verifyRelease(directory);
const expected = '5142c4e6bd9e92bf672d84527076c7bba0806ca1';
if (manifest.gitCommit !== expected || manifest.buildId !== `git-${expected}`) throw new Error('不是本次失败的原发布包');
console.log('原发布包内容校验通过。');
NODE

chmod -R g+rX,g-w,o-rwx "$pf_release"
runuser -u problemforge -- env -i HOME=/opt/problemforge/shared/home LANG=C.UTF-8 \
  PATH="$(dirname "$pf_node"):/usr/local/bin:/usr/bin:/bin" \
  "$pf_node" --import "$pf_loader" --eval ''
printf '%s\n' '服务账号依赖加载通过，继续部署原版本。'
rm -- "$pf_lock"
trap - EXIT

bash "$pf_release/deploy.sh"
bash /opt/problemforge/current/deploy.sh status
test "$(node -p 'JSON.parse(require("node:fs").readFileSync("/opt/problemforge/shared/last-deploy.json", "utf8")).gitCommit')" = 5142c4e6bd9e92bf672d84527076c7bba0806ca1
test ! -e /opt/problemforge/shared/pending-deploy.json
printf '%s\n' '新版部署完成，版本一致，健康检查通过。'
)
```

部署结束后强制刷新网页，并重新构建需要查看新排版的 PDF。新版部署器的永久修正已在本地代码中；下一次更新可随源码正常交付。上述手动恢复只解决本次已准备目录，不代替未来版本的代码修正。

## 6. 查看管理员账号并检查网站

```bash
cat /opt/problemforge/shared/bootstrap-admin.txt
. /opt/problemforge-tools/env.sh
bash /opt/problemforge/current/deploy.sh status
```

打开 `https://problems.cwnupaa.com/login?mode=admin`，使用文件中的邮箱、随机密码登录；普通成员使用协会账号。密码只在自己的终端查看即可。

以后升级使用文末的 `bash deploy.sh update`。存在未完成迁移时，该命令先完成原版本，成功后再执行同一命令更新源码提交。查看本项目日志可以运行 `tail -n 80 /opt/problemforge/shared/logs/api.err.log`；不要提供包含私有 JSON 或管理员密码的终端内容。

实际验证范围：部署定向检查现为 14 项，通过；Linux Caddy 2.10.2 实际复现绝对/相对配置路径导致的 hide 差异，并验证选择相对调用后精确匹配、真实配置差异仍拒绝。只读命令使用模拟的管理接口响应通过，不监听端口。此前已完成自定义目录、相对 import、原站点保留及 PM2 启动/重载夹具。没有登录用户云服务器或执行真实 Caddy 重载、Ubuntu 安装和业务任务。Node 归档仅核对官方校验清单，未在本机执行上述服务器安装命令。

## 更新已有站点

继续使用原 Ubuntu / PM2 / Caddyfile、域名和题库。代码先由开发者提交并推送，服务器拉取后运行统一更新入口即可；不重复安装工具或填写密钥。安排短暂维护窗口，先等待判题、构建任务完成。

2026-10-15 的大数据修复将生成器/单个测试文件上限提高到 64 MB。沿用下述 update 命令即可更新 Judge 沙箱及本站 Caddy 托管块的上传限制（256 MiB，用于容纳 Base64 请求体），不需要手工编辑配置。更新成功后刷新网页，重新点击「生成答案」或「执行生成计划」创建当前版本任务；「重试原快照」保留原 8 MB 策略，会因策略版本不匹配而拒绝。

尚未推送的本机提交，由操作者在 Windows PowerShell 执行：

```powershell
Set-Location 'D:\project\ProblemForge'
git push origin master
```

然后在原服务器的 root SSH 终端执行：

```bash
cd /root/ProblemForge && git pull --ff-only origin master && bash deploy.sh update
```

`update` 自动载入已配置的 `/opt/problemforge-tools/env.sh`，使用原 caddy-l4 和本站 Node / pnpm / PM2。它先核对配置、Caddy 与本站端口归属，要求源码干净，按当前 Git 提交生成并校验不可变发布包，再准备依赖和前端。遇到其他服务占用端口会停止，不换端口或停止占用服务。

沙箱 Dockerfile、COPY 输入和 .dockerignore 未变时，核对原站容器归属、运行状态及实际镜像后复用；改变的沙箱才构建。每类镜像准备完成立即记录其 ID，失败后重试可复用已完成部分。这次修正 Python 主包和依赖的版本锁定，因此 Judge 需要重建一次；已在本机实际构建并核对包版本通过。TeX 在构建输入未变时复用。

准备成功后，脚本自动静止本站写入并备份数据库、私有文件和服务器配置，再检查迁移、启动新版、切换 current，最后验证本机和 HTTPS。备份在 `/opt/problemforge/shared/backups/<时间>/`，含 database.dump、storage.tar、state.json、configuration/ 和 SHA-256 清单；configuration 包含环境文件、PM2 配置、Caddyfile 和原版本路径，目录仅 root 可访问。无需手动复制配置或计算发布目录。

成功会显示「部署完成：git-<提交>，本机及 HTTPS 健康检查通过」。相同提交再次运行只检查当前健康，不重复部署。打开网站强制刷新，确认归档筛选、创建者列、新建题面模板；重新构建双样例 PDF，确认合表和题头对齐，历史 PDF 不会被原地改写。

若失败，保留报错；修复原因后仍执行 `bash deploy.sh update`。构建失败发生在停止原站之前；备份等迁移前步骤失败会尝试恢复原进程。存在 pending 时，入口使用新版部署器完成 pending 指定的原包，不越过迁移保护切换提交，完成后会提示再运行同一命令更新源码。仍在运行的部署或遗留锁不会被自动抢占，迁移后失败也不会自动回退生产库。

## 更新占用与旧文件清理

旧部署器每次更新都保留一个完整发布目录（含依赖和前端构建）、一份完整 `storage.tar`/数据库备份和源码打包文件，没有自动轮转，因而随更新次数累积。2026-10-18 用户提供的服务器只读统计为发布目录 5.6G、备份 2.7G、打包目录 78M；这说明主要累计在发布目录和备份，不能将这些数字全部视为可删除空间。

拉取本次修复后，可以先清理历史积累，再更新服务，减少更新前需要的空闲空间：

```bash
cd /root/ProblemForge
git pull --ff-only origin master
bash deploy.sh cleanup
```

以上仅预览保留项和候选，不删除文件。确认输出后执行：

```bash
bash deploy.sh cleanup --apply
bash deploy.sh update
df -h /opt/problemforge
```

清理只处理 `/opt/problemforge` 下清单可验证的发布目录/备份和当前源码目录的完整发布包。最近两个成功版本、当前运行和 PM2 开机恢复引用的版本、最近两份自动备份及它们对应的代码均保留，因此实际保留版本可能超过两个。手动 `backup` 新增用途标记，始终保留；旧版未区分手动/自动的历史备份在普通 update 中保留，只在显式 `cleanup --apply` 时连同自动备份一起轮转至最近两份。如果旧版曾手动保存过需要长期保留的备份，先复制到独立归档位置再执行本次历史清理。

首次显式清理完成后，`shared/cloud-retention.json` 记住历史备份也参与轮转的选择；留下的两份旧备份随后会随新的自动备份正常轮换，避免永久积压。预览不会启用该选择。

存在 pending、部署状态不一致或健康/资源归属检查失败时不清理；损坏、未知、未完成备份和没有成功证据的发布目录保留并说明原因。保留备份引用的版本不会删掉；来源无法确定的未完成备份会保护所有版本。保留旧代码不代表可以直接回退已迁移数据库，恢复仍须使用独立空目标。

以后每次部署通过本机及 HTTPS 检查、记录成功后自动轮转，重复运行同一版本 update 也能触发清理。清理失败只提示警告，不撤销成功部署。更新内部打包不再生成多余运输压缩包，解包后立即移除临时 `source.tar`；普通 `pnpm package:cloud` 仍生成可分发归档。旧镜像仅按被删除版本的原始记录移除精确标签，任何容器引用的镜像保留并待后续再检查；不执行全局 Docker prune，不清理其他项目、数据卷或共享构建缓存。候选大小是文件逻辑大小，受 pnpm 硬链接及 Docker 共享层影响，实际回收以 `df` 前后变化为准。

本机已验证真实镜像构建、Git 打包和无监听的 Linux 命令夹具；夹具中的 Docker、PM2、Caddy、数据库与 HTTP 使用模拟响应。目标服务器最终结果仍以该服务器输出及网站验收为准。
