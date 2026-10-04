# dsh-remote-control

独立的 DSH Web 插件。电脑上点击会话标题旁的链接图标后，插件启动公网隧道，并显示一次性链接和二维码。手机用浏览器打开链接后直接进入 DSH Web，可通过侧边栏切换会话。手机可以使用蜂窝网络或异地网络。

## 安装

需要正在运行的 DSH Web profile。默认在开启远控时自动选择入口：Mac 的 Tailscale 已连接则使用 [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel)，需启用 MagicDNS、HTTPS 和 Funnel 权限；关闭、未登录或不可用则使用已安装的 [cloudflared](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)，手机无需 Tailscale。两种工具都需在电脑上准备好，才能使用自动选择的两条路径。开发依赖中的 `link:` 路径假定本插件与 `deepseek-harness` 同在 `AIProjetcs` 目录下；如目录不同，先调整 `package.json` 的开发链接。打包产物不依赖这些路径。

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

## 开发热更新

热更新需要链接安装本仓库，并在目标 Profile 启用 `@deepseek-ai/dsh-hmr`、监听本插件的 `lib/`。安装 `.tgz` 实体包后的版本替换仍需重启；桌面 Profile 的安装操作使用应用内插件管理器。

例如多个插件共同开发时，Profile 的 `hmr` 条目可以配置为：

```yaml
- id: hmr
  name: "@deepseek-ai/dsh-hmr"
  disabled: false
  config:
    base: /Users/wangqiongkaka/AIProjetcs/dsh-plugin
    root:
      - dsh-harness-provider/.cache/live/dist
      - dsh-git-sidebar/lib
      - dsh-remote-control/lib
```

配置生效后，运行 `npm run build` 即可发布新产物。构建会保留被监听的 `lib/` 目录，覆盖入口文件；不要先删除整个 `lib/`，否则目录监听会失效，后续构建无法触发重载。若旧构建已使监听失效，需要重新加载 HMR 配置或重启一次 DSH，之后的构建无需再重启。插件重载会执行其停止逻辑，当前手机配对连接需要重新开启。

## 使用与限制

在电脑的 DSH Web 中打开任一会话，点击标题旁的链接图标。每次打开弹窗都会显示可用二维码和可复制链接，已连接时也会显示访问有效期。链接默认五分钟内有效且只能使用一次，使用后或过期会自动更新；配对成功后手机访问权限默认一直有效，弹窗显示「长期有效」。重新打开弹窗、更新二维码或切换工作区不会中断当前手机连接，也不会重启隧道。重新扫码成功后会替换原配对，立即撤销原手机的访问凭证并关闭其 HTTP 和 WebSocket 长连接，新连接按配置获得访问权限；无效或过期的扫码不会影响当前手机。点击「停止远程控制」、关闭 DSH 或重载插件都会撤销手机访问，需要重新扫码。

手机配对使用持久 Cookie，关闭并重新打开浏览器后可继续访问。服务端默认不按时间撤销权限；Cookie 设置为 400 天，并在手机访问时续期，这是 [Chrome 的 Cookie 保留上限](https://developer.chrome.com/blog/cookie-max-age-expires)。长期不访问、清除浏览器数据或浏览器提前删除 Cookie 后，需要重新扫码。

手机窗口由代理注入一层窄屏补丁：侧边栏变成覆盖式抽屉，从左边滑入、滑回左边，动画时长与曲线和右侧栏一致，背后的暗色遮罩同步淡入淡出（系统开启减少动态效果时不播动画；点击会话、搜索结果、Agent 卡片里的会话，或用工作区行的「+」新建会话后，自动收起并直接进入会话页面，点击抽屉右侧的空白遮罩也会收起）；手机宽度（≤720px）下抽屉铺满全屏，通过侧边栏顶部自带的收起按钮关闭，平板宽度保留 320px 抽屉；抽屉里每个顶层项目显示为一张描边卡片（树形分组下的子工作区留在父卡片内缩进），手机宽度下项目行和会话行放大到便于触控的 44/40px；抽屉顶部的「新会话」按钮换成「Agent 运行」卡片：三格分别统计待确认（等待审批、计划待审或等待回答）、运行中、已完成（完成后尚未再次打开）的会话，下方默认显示运行中会话，点击任一统计格后原位切换为对应会话列表，每行开头是该会话的 harness 图标（运行中时呼吸闪动，图标由 harness-provider 插件提供，未安装时显示状态点），点任一会话行切到该会话并收起抽屉。新建会话改用工作区行右侧的「+」；抽屉里当前会话用侧边栏自身的选中底色标出，手指划过或点过的行不再残留与选中态同款的高亮（这一条由客户端插件注入，刷新页面即生效，不必重启 DSH）；聊天记录滚动时输入框固定在屏幕底部；手机宽度下对话文字左右各留 16px，与输入框对齐（原为 32px），右侧的轮次导航条不显示；输入框工具行保持单行，两端固定不动——左边是附件按钮，右边是麦克风与发送按钮——中间的标签（权限模式、harness、配额、模型）整体横向滑动，放不下时不再被压缩成互相重叠的碎片，各标签完整显示、不再省略，插件自带的标签组也统一为 4px 间距；工具行滑到两端后继续拉动，中间的标签会被拉开并在松手后弹回（系统开启减少动态效果时直接复位），两端按钮始终不动；行内向上弹出的菜单（harness 切换、权限模式、配额详情）挂在输入卡片上而不在那行自己的滚动裁剪区内，所以不会被裁掉，也不会带着两侧按钮或滚动位置一起跳；浮层高度按动态视口计算，不会被浏览器工具栏截断。软键盘适配分两条路：代理把文档的 viewport meta 补成 `interactive-widget=resizes-content`（Chromium 会让布局视口随键盘收缩），其余浏览器由客户端接管——它把键盘算成「当前可见高度（两个视口里较小的那个）相对手机静息高度的下降量」，判定到键盘弹起就把外壳压到可见高度，并把被聚焦的输入框滚进可视区（WebKit 只在用户开始打字时才滚动它），键盘收起后立即恢复。

「已完成」下方另列「历史会话」，保存手机页面观察到的最近 5 个已完成会话，刷新后仍可查看并打开。「已完成」数字只统计待查看的完成提醒，不包含历史记录；当前正在查看的会话完成后也会产生提醒，返回侧边栏即可看到，完成后再次打开该会话才清除提醒并进入历史列表（Agent 卡片、普通会话行和搜索结果均适用）。再次运行或等待确认时清除旧提醒，归档或删除的会话不再显示。

手机侧边栏使用统一的纵向滚动条，Agent 卡片、插件入口和工作区一起滚动，不再各占一个小滚动区；顶部 DeepSeek Harness 品牌栏和底部「设置」固定在原位。内容滚到最上方或最下方后继续拖动，会带阻力拉伸并在松手时回弹，品牌栏和设置不跟随移动（开启减少动态效果时立即复位）。

手机端在会话主区域右滑可打开左侧栏，左滑可打开右侧栏；在打开的侧栏里反向滑动即可收起，手指从行、标签等按钮上开始滑也有效，只有输入框、弹出菜单，以及还能朝该方向滚动的横向列表会优先处理自己的滑动（网页预览这类内嵌页面里的滑动无法捕获）。输入区和可横向滚动的内容沿用原有触摸操作。

远程页面的「工作步骤展示」和「性能与用量」默认为「简洁」。DSH 只为本机页面保存这两项设置，远程页面上的选择只在当前页面有效，刷新后回到「简洁」，也不会改动电脑上的设置。手机宽度下的设置窗口不显示「模型」分区，模型配置请在电脑上进行。

插件只在本机回环地址上代理已有的 DSH Web 服务。所选隧道提供 HTTPS 入口（`access: tailnet` 时入口只在 tailnet 内可达，手机需登录同一 tailnet）；插件校验请求来源、消耗一次性配对凭证，并以独立 HttpOnly Cookie 授权手机。DSH 的本地浏览器 Cookie 不会发给手机。插件允许与其他端口的 Serve/Funnel 映射共存，例如 DSH 使用 443、前端使用 8443；目标端口被后台或前台会话占用时会拒绝启动，报错包含端口，不会覆盖已有映射。唯一可自动清理的残留是配置中只有本插件目标端口的 Foreground 会话、且其所有回环后端都已停止；配置中包含其他端口或后台映射时不会执行全局清理。停止远程控制只关闭本次启动的代理和前台隧道，保留其他映射。电脑关闭 DSH 或隧道进程后，远程入口不可用；Tailscale 入口也会在电脑断开 Tailscale 后失效。

可通过 profile 的 `cordis.patch.yml` 覆盖 `remote-control` 行的 `tailscaleBinary`、`cloudflaredBinary`、`publicTunnel`、`access`、`funnelPort`（443、8443 或 10000）、`invitationTtlMs`、`browserTtlMs`、`startupTimeoutMs` 和 `stopTimeoutMs`。`browserTtlMs` 默认 `0`，表示手机访问权限一直有效；仍可设置 1,000 至 86,400,000 毫秒的有限有效期，显式配置会覆盖默认值。`access` 默认 `public`，`publicTunnel` 默认 `auto`，开启远控时检查 Mac 的 Tailscale 状态：已连接则用 `tailscale funnel`，否则用 Cloudflare Quick Tunnel；也可显式配置 `tailscale` 或 `cloudflare` 固定入口。选择仅在创建新隧道时执行；重新打开弹窗、更新二维码、切换工作区和手机切换 Wi-Fi/5G 都不会更换已有入口；改为 `tailnet` 则用 `tailscale serve`，只有同一 tailnet 内的设备能打开链接，不再暴露公网入口（公网入口会把这些请求中继到本机，链路慢时首屏会很慢）。Funnel 的命令形式参见 [Tailscale CLI 文档](https://tailscale.com/docs/reference/tailscale-cli/funnel)。

使用 Tailscale 入口并需要「直连优先、公网备用」时，保持 `access: public` 和 `publicTunnel: tailscale`，并在手机上开启 Tailscale、连接同一 tailnet、启用 Tailscale DNS（MagicDNS）。手机通过同一 HTTPS 域名访问 tailnet 内的服务，Tailscale 会优先尝试直接连接；同一 Wi-Fi 且设备间互通时可走本地路径，5G 下也会尝试直连，不能直连时回退到 Tailscale 中继。关闭手机 Tailscale、改用公网 DNS 后，同一域名通过 Funnel 公网入口访问。公网 Funnel 本身仍有中继和带宽限制，不能保证比 5G 下的 Tailscale 直连更快。该策略由 Tailscale 与 DNS 处理，适用于 Safari 和 Chrome。连接机制参见 [Tailscale 连接类型](https://tailscale.com/docs/reference/connection-types)、[MagicDNS](https://tailscale.com/docs/features/magicdns) 和 [Funnel 工作原理](https://tailscale.com/docs/features/tailscale-funnel)。

已有 profile 的显式 `access: tailnet` 会覆盖插件的默认值，需要改为 `public` 并重新开启远程控制。插件重载后需重新扫码；配置中其他端口的 Serve/Funnel 服务会保留。

## Cloudflare 公网入口

自动模式在 Mac 未连接 Tailscale 时使用 Cloudflare Quick Tunnel。先安装 `cloudflared`，再配置 Profile：

```yaml
- id: remote-control
  name: dsh-remote-control
  config:
    access: public
    publicTunnel: auto
    cloudflaredBinary: /你的实际安装路径/cloudflared
    startupTimeoutMs: 60000
```

Mac 的 Tailscale 未连接时重新开启远程控制，二维码使用 `https://随机名称.trycloudflare.com/`；已连接时使用原来的 `ts.net` 入口。若要固定使用 Cloudflare，把 `publicTunnel` 改为 `cloudflare`。插件等待隧道注册连接，并确认公网地址能到达配对服务后才显示链接；只代理现有配对服务，不修改或清理其他 Tailscale 映射。手机不需要开启 Tailscale。配对后，同一手机、同一浏览器从 Wi-Fi 切换到 5G、断线后重新连接或关闭再打开浏览器，都继续使用相同的访问 Cookie，无需重新扫码。正在传输的连接可能因网络切换中断，是否自动重新连接由 DSH Web 客户端处理。

运行中开启或关闭 Mac 的 Tailscale 不会自动替换入口；停止远控后再次开启会重新判断。Mac 从已连接变为未连接时，原来的 Tailscale 入口可能中断，需要重新开启远控并用新的 Cloudflare 二维码配对。Quick Tunnel 在每次重新启动后分配新域名；停止远控、重启 DSH 或插件重载后，需使用新二维码重新配对。新公网域名始终经过 Cloudflare，不具有 Tailscale 域名的 Wi-Fi 自动直连策略。`access: tailnet` 仍使用 Tailscale Serve，忽略 `publicTunnel`。

Quick Tunnel 无需账号或自有域名，支持本插件使用的 WebSocket；没有可用性保证，最多 200 个同时进行的请求，不支持 SSE。需要固定域名或 SSE 时使用正式 Cloudflare Tunnel，此插件当前只支持 Quick Tunnel。限制参见 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 和 [WebSocket 支持](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/)。

## 手机访问前端服务

手机与电脑在同一局域网或同一 Tailscale 网络时，直接访问电脑上的开发服务即可。以 Vite 为例，让服务监听所有网卡（只监听 `localhost` 或 `127.0.0.1` 时手机无法直连）：

```sh
npm run dev -- --host 0.0.0.0
```

在手机浏览器的独立标签页中打开 `http://电脑的IP:实际端口`，例如 `http://100.x.y.z:5173`。使用 Tailscale 时通过 `tailscale ip -4` 获取电脑的地址；同一局域网下也可以使用电脑的局域网 IP。端口以开发服务启动输出为准，电脑防火墙和 Tailscale 访问规则须允许该连接。此方式无需插件代理或额外配对，服务访问权限由网络规则和应用自身管理。Vite 的监听配置参见 [官方文档](https://vite.dev/config/server-options)，Tailscale 直连方式参见 [官方文档](https://tailscale.com/docs/how-to/connect-to-devices)。

页面中的 API 地址若写成 `localhost`，会指向手机自身；可通过开发服务的同源代理访问电脑上的后端。此方式用于手机实际浏览器中的页面预览，不提供 Console、Network 或断点调试工具。

需要 HTTPS 时也可以直接使用 Tailscale 原生代理，前端仍可监听回环地址。启动服务后运行 `tailscale serve --https=8443 http://127.0.0.1:5173`，手机打开 `https://电脑的完整Tailscale域名:8443`；前台命令按 `Ctrl+C` 关闭。8443 须未被占用，手机需连接同一 tailnet，开发框架也须允许该域名。新增服务使用不同的 HTTPS 端口即可，无需修改插件代码。参见 [Tailscale Serve 文档](https://tailscale.com/docs/reference/tailscale-cli/serve)。

## 验证

运行 `npm run check`，依次完成构建、类型检查和全部测试；测试直接引用 `dist/` 构建产物。测试用假的 Tailscale/cloudflared 命令和本机 HTTP 服务验证一次性配对、二维码更新、替换配对时旧凭证及长连接的撤销、完整 Web 路由代理、Host/Origin 拒绝及停止后的撤销，并验证弹窗重新打开和已配对时的二维码展示。公网 HTTP 和 WebSocket 连通性需要通过实际隧道单独验证。
