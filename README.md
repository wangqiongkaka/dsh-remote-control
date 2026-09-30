# dsh-remote-control

独立的 DSH Web 插件。电脑上点击会话标题旁的链接图标后，插件启动 Tailscale Funnel，并显示一次性链接和二维码。手机用浏览器打开链接后直接进入 DSH Web，可通过侧边栏切换会话。手机可以使用蜂窝网络或异地网络。

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

在电脑的 DSH Web 中打开任一会话，点击标题旁的链接图标。插件显示二维码和可复制链接。链接五分钟内只能配对一台手机；配对成功后浏览器会话默认持续十二小时。点击「停止远程控制」会关闭代理和前台 Funnel，立即撤销该次手机访问。链接过期前再次打开弹窗会复用同一链接，过期后自动换新链接。在其他工作区打开弹窗不会重启隧道；已配对时弹窗只显示配对状态，手机保持连接，可在手机上自行切换工作区。需要配对另一台手机时，停止后重新开启。

手机窗口由代理注入一层窄屏补丁：侧边栏变成覆盖式抽屉（点击会话、搜索结果或 Agent 看板里的会话后自动收起并回到会话页面，点击抽屉右侧的空白遮罩也会收起）；手机宽度（≤720px）下抽屉铺满全屏，通过侧边栏顶部自带的收起按钮关闭，平板宽度保留 320px 抽屉；抽屉里每个顶层项目显示为一张描边卡片（树形分组下的子工作区留在父卡片内缩进），手机宽度下项目行和会话行放大到便于触控的 44/40px；抽屉顶部的「新会话」按钮换成「Agent 运行」卡片：三格分别统计待确认（等待审批、计划待审或等待回答）、运行中、已完成（结束后还没打开过）的会话，下面预览最多 3 条，待确认的排最前，每行开头是该会话的 harness 图标（运行中时呼吸闪动，图标由 harness-provider 插件提供，未安装时显示状态点），点预览行直接进入该会话；点统计格或「查看全部」打开铺满抽屉的 Agent 看板，可按全部、待确认、运行中、已完成筛选，点任一行切到该会话并收起抽屉。新建会话改用工作区行右侧的「+」；抽屉里当前会话用侧边栏自身的选中底色标出，手指划过或点过的行不再残留与选中态同款的高亮（这一条由客户端插件注入，刷新页面即生效，不必重启 DSH）；聊天记录滚动时输入框固定在屏幕底部；输入框工具行保持单行，两端固定不动——左边是附件按钮，右边是麦克风与发送按钮——中间的标签（权限模式、harness、配额、模型）整体横向滑动，放不下时不再被压缩成互相重叠的碎片，各标签完整显示、不再省略，插件自带的标签组也统一为 4px 间距；工具行滑到两端后继续拉动，中间的标签会被拉开并在松手后弹回（系统开启减少动态效果时直接复位），两端按钮始终不动；行内向上弹出的菜单（harness 切换、权限模式、配额详情）挂在输入卡片上而不在那行自己的滚动裁剪区内，所以不会被裁掉，也不会带着两侧按钮或滚动位置一起跳；浮层高度按动态视口计算，不会被浏览器工具栏截断。软键盘适配分两条路：代理把文档的 viewport meta 补成 `interactive-widget=resizes-content`（Chromium 会让布局视口随键盘收缩），其余浏览器由客户端接管——它把键盘算成「当前可见高度（两个视口里较小的那个）相对手机静息高度的下降量」，判定到键盘弹起就把外壳压到可见高度，并把被聚焦的输入框滚进可视区（WebKit 只在用户开始打字时才滚动它），键盘收起后立即恢复。

手机端在会话主区域右滑可打开左侧栏，左滑可打开右侧栏。输入区和可横向滚动的内容沿用原有触摸操作。

远程页面的「工作步骤展示」和「性能与用量」默认为「简洁」。DSH 只为本机页面保存这两项设置，远程页面上的选择只在当前页面有效，刷新后回到「简洁」，也不会改动电脑上的设置。手机宽度下的设置窗口不显示「模型」分区，模型配置请在电脑上进行。DSH 只在桌面端显示「账号与余额」，远程页面由本插件补一个只读的同名分区：显示当前登录的 DeepSeek 账号、余额与赠送余额，以及用量明细链接；登录、退出和充值仍在电脑上操作。

插件只在本机回环地址上代理已有的 DSH Web 服务。Tailscale 提供 HTTPS 入口（`access: tailnet` 时入口只在 tailnet 内可达，手机需登录同一 tailnet）；插件校验请求来源、消耗一次性配对凭证，并以独立 HttpOnly Cookie 授权手机。DSH 的本地浏览器 Cookie 不会发给手机。若本机已有 Funnel 配置，插件会拒绝启动以免覆盖它；唯一的例外是上一次 DSH 进程退出时遗留的 Foreground 会话（其回环后端已随该进程消失，清掉这条残留也会让孤立的 `tailscale funnel` 退出）。电脑关闭 DSH 或断开 Tailscale 后，远程入口不可用。

可通过 profile 的 `cordis.patch.yml` 覆盖 `remote-control` 行的 `tailscaleBinary`、`access`、`funnelPort`（443、8443 或 10000）、`invitationTtlMs`、`browserTtlMs`、`startupTimeoutMs` 和 `stopTimeoutMs`。`access` 默认 `public`，用 `tailscale funnel` 开公网入口；改为 `tailnet` 则用 `tailscale serve`，只有同一 tailnet 内的设备能打开链接，不再暴露公网入口（公网入口会把这些请求中继到本机，链路慢时首屏会很慢）。Funnel 的命令形式参见 [Tailscale CLI 文档](https://tailscale.com/docs/reference/tailscale-cli/funnel)。

## 验证

`pnpm typecheck`、`pnpm test`、`pnpm build`。测试用假的 Tailscale 命令和本机 HTTP 服务验证一次性配对、完整 Web 路由代理、Host/Origin 拒绝及停止后的撤销。公网连通性需要在已启用 Funnel 的机器上实际验证。
