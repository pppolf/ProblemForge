# 日常备份与容量维护

这些命令只操作本项目专用 Compose project。默认不删除备份、历史文件、缓存、登记行或未完成预留，不设置机器计划任务，也不发送外部通知。

## 配置并执行加密备份

先创建随机 256 位密钥，已有文件不会覆盖：

```sh
pnpm maintenance keygen --out .local/keys/backup.key
```

在忽略目录保存配置，例如 `.local/backup-policy.json`：

```json
{
  "env": ".local/production.env",
  "destination": ".local/encrypted-backups",
  "keyFile": ".local/keys/backup.key",
  "keepLatest": 7,
  "maxAgeDays": 30
}
```

```sh
pnpm maintenance backup --config .local/backup-policy.json
pnpm maintenance retention --config .local/backup-policy.json
```

备份调用现有一致备份流程：停止 API/两 Worker、拒绝未收敛的 RUNNING 任务、核对文件和迁移、导出数据库/私有卷，随后恢复服务。相同 project 的 up/backup/restore/storage-check 在当前部署主机使用独占维护锁，拒绝并发操作。异常杀进程可能留下锁，先核对锁内 PID 和容器状态，再人工处理，不能盲目抢锁。

四个备份文件分别流式 AES-256-GCM 加密，每个文件使用独立随机 nonce，认证内容绑定备份标识和文件名。只有四个文件成功后才写 `encryption.json` 完成标记。元信息仅含算法、密钥指纹和时间，不含密钥。备份完成/失败均记录 `.local/maintenance-results/<运行ID>.json`，包括结果、时间及失败原因；退出码非零表示失败，可由部署主机既有调度器调用并观察退出状态。强制杀进程的 RUNNING 记录需要人工复核，不能当成成功。

明文仅暂存在本项目 `.local/maintenance-temp/temporary-<运行ID>`，正常成功/失败均逐个清除本次固定成员并删除空目录；不递归删除。异常断电或清理失败会保留现场并提示，应在确认无执行进程后人工清理。Linux 目录使用 0700、密钥/结果文件 0600；Windows 应限制这些目录的 NTFS 访问权限。加密备份、密钥和部署凭据分别另存到受控介质；遗失密钥无法解密，密钥不随备份包分发。更换密钥只影响新备份，旧备份仍需对应旧密钥。这里使用随机密钥文件，不接受普通口令。

保留预览同时保护最新 N 份和最近 N 天的备份，最新备份即使很旧也不列为待处理。缺少完成标记或成员的目录单独列出；元信息预览不代表解密认证成功。`review` 仅供人工检查，不执行删除、不自动上载，也不创建额外备份目的地。

## 空实例恢复

```sh
pnpm ops init --env .local/recovery.env --name problemforge-recovery --port 5185
# 将 recovery.env 的 PF_APP_IMAGE 设置为加密备份对应的原镜像 ID/保留标签。
pnpm maintenance restore --env .local/recovery.env --from .local/encrypted-backups/<备份目录> --key-file .local/keys/backup.key
```

先认证解密全部四个成员，再调用原恢复流程；错误密钥、截断或改动的包在任何目标数据库/卷写入前失败。之后仍要求不同 project、未运行过应用的空库/空卷、与备份一致的镜像 ID、明文摘要和全部登记文件/迁移一致；不能以解密成功代替恢复校验。恢复账号来自备份，初始化配置中的新密码不会覆盖旧账号。镜像及数据库回退规则见 [DEPLOYMENT](DEPLOYMENT.md)。

## 容量、文件一致性与清理预览

管理员「运行与审计」显示总登记量、未完成预留字节/最早时间、编译缓存引用的去重文件字节，以及近 30 天按 UTC 统计的新增登记量。后者包含预留，是当前仍登记对象的创建量，不是磁盘容量的历史采样；缓存已包含在总量，不能再相加。`STORAGE_WARNING_PERCENT` 默认为 80，范围 1—100；达到阈值显示告警，达到容量显示 full，原原子容量限制继续生效。

```sh
pnpm ops storage-check --env .local/production.env --out .local/maintenance/storage-report.json
```

命令短暂停止写入，逐文件流式核对字节/哈希，扫描数据库当前所有 JSON 字段和显式文件键列；覆盖冻结/历史修订、任务快照/报告、产物、发布与撤回材料、缓存引用。引用文件全部保留；缺失、损坏、未登记文件/引用单独报告。未完成预留及最近 7 天的文件不列为清理候选。仅超过宽限期、已完整登记、文件一致且未发现任何引用的对象出现在 `cleanupPreview.candidates`，仍需人工复核；`canDelete` 固定 false，无删除入口。

盘点是停写后的全量只读检查，适合计划维护窗口，不在默认测试、日常页面刷新或业务请求里扫描文件。文件系统链接/特殊文件或活动 RUNNING 记录会使盘点失败；不绕过错误继续给删除建议。结果包含私有存储键，按管理员数据保管。当前本地工具不提供跨主机分布式维护锁、磁盘历史采样、外部备份上传或通知通道。

显式定向检查 `pnpm verify:p7:maintenance` 使用独立数据库和临时对象验证加密、引用保留、损坏诊断与容量阈值，不执行作者程序或 TeX；真实空实例恢复另按上述命令执行。
