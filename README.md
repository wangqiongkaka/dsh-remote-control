# dsh-remote-control

独立的 DSH Web 插件。电脑上点击会话标题旁的链接图标后，插件启动 Tailscale Funnel，并显示一次性链接和二维码。手机用浏览器打开链接后先看到该工作区的会话列表，随后可以使用完整的 DSH Web 界面。手机可以使用蜂窝网络或异地网络。

## 安装

需要正在运行的 DSH Web profile，以及已登录并启用 MagicDNS、HTTPS 和 Funnel 权限的 [Tailscale](https://tailscale.com/docs/features/tailscale-funnel)。开发依赖中的 `link:` 路径假定本插件与 `deepseek-harness` 同在 `AIProjetcs` 目录下；如目录不同，先调整 `package.json` 的开发链接。打包产物不依赖这些路径。

```sh
cd /Users/wangqiongkaka/AIProjetcs/dsh-plugin/dsh-remote-control
pnpm install
pnpm pack
```

从 DSH 源码目录安装生成的包：

```sh
pnpm dsh plugin --profile web add file:/Users/wangqiongkaka/AIProjetcs/dsh-plugin/dsh-remote-control/dsh-remote-control-0.1.0.tgz
```

使用已安装的 `dsh` CLI 时，去掉 `pnpm`。安装后重启 Web profile 并重新打开 Web 页面。插件只向 profile 安装自己的 bundle，不要求修改 DSH 主仓库。若同版本重新打包，需要先移除旧包再安装，避免 pnpm 复用缓存。

## 使用与限制

在电脑的 DSH Web 中打开任一会话，点击标题旁的链接图标。插件显示二维码和可复制链接。链接五分钟内只能配对一台手机；配对成功后浏览器会话默认持续十二小时。点击「停止远程控制」会关闭代理和前台 Funnel，立即撤销该次手机访问。链接过期前再次打开弹窗会复用同一链接，过期后自动换新链接。在其他工作区打开弹窗不会重启隧道：未配对时链接改为进入该工作区；已配对时弹窗只显示配对状态，手机保持连接，可在手机上自行切换工作区。需要配对另一台手机时，停止后重新开启。

插件只在本机回环地址上代理已有的 DSH Web 服务。Tailscale 提供 HTTPS 入口（`access: tailnet` 时入口只在 tailnet 内可达，手机需登录同一 tailnet）；插件校验请求来源、消耗一次性配对凭证，并以独立 HttpOnly Cookie 授权手机。DSH 的本地浏览器 Cookie 不会发给手机。若本机已有 Funnel 配置，插件会拒绝启动以免覆盖它；唯一的例外是上一次 DSH 进程退出时遗留的 Foreground 会话（其回环后端已随该进程消失，清掉这条残留也会让孤立的 `tailscale funnel` 退出）。电脑关闭 DSH 或断开 Tailscale 后，远程入口不可用。

可通过 profile 的 `cordis.patch.yml` 覆盖 `remote-control` 行的 `tailscaleBinary`、`access`、`funnelPort`（443、8443 或 10000）、`invitationTtlMs`、`browserTtlMs`、`startupTimeoutMs` 和 `stopTimeoutMs`。`access` 默认 `public`，用 `tailscale funnel` 开公网入口；改为 `tailnet` 则用 `tailscale serve`，只有同一 tailnet 内的设备能打开链接，不再暴露公网入口（公网入口会把这些请求中继到本机，链路慢时首屏会很慢）。Funnel 的命令形式参见 [Tailscale CLI 文档](https://tailscale.com/docs/reference/tailscale-cli/funnel)。

## 验证

`pnpm typecheck`、`pnpm test`、`pnpm build`。测试用假的 Tailscale 命令和本机 HTTP 服务验证一次性配对、完整 Web 路由代理、Host/Origin 拒绝及停止后的撤销。公网连通性需要在已启用 Funnel 的机器上实际验证。
