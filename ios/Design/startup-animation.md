# 启动动画设计方案

来源：[Sleek 项目](https://sleek.design/project/Q9BriRwhx9z)。屏幕 `YUWNUSbCRnc`，组件 `1GSEkUbL9Rt`，静态设计版本 5（`vzfNdKu4mc5`），生成任务 `aRb0q4IvRhr`。

设计已接入原生 `StartupView.swift`，沿用现有导航回调。设计以现有鲸鱼标志、品牌矢量字标和黑白配色为基础，说明文字使用系统字体，品牌蓝只用于三颗连接光点。

- `deepseek-wordmark.svg`：按用户参考图采用全小写品牌字形，只读提取自现有宿主的 `packages/client/ui-primitives/src/BrandWordmark.tsx`；只保留文字的 9 个原始路径，不含鲸鱼或 HARNESS 徽标。预览以内联 SVG 使用该字标，颜色随深浅色变化，不依赖字体下载；宿主文件未修改。
- `startup-animation.html`：Sleek 原始静态导出；平台未保留自定义动画样式。
- `startup-animation-design.png`、`startup-animation-review.png`：Sleek 首屏与完整核对截图。
- `startup-project-overview.png`：当前项目全部页面全览；另外两个页面未修改。
- `startup-animation-preview.html`：无外部依赖的可运行动画；可直接打开，默认持续显示连接等待。
- `startup-animation-preview.png`、`startup-animation-light.png`：无界面浏览器的深浅色预览截图。
- `startup-animation-native.png`、`startup-animation-native-light.png`：生产原生 `StartupView` 的深浅色模拟器截图。
- `startup-animation.gif`：演示入场、连接等待、打开工作区与淡出的动图。录制中约三秒后切换状态，仅为演示，不代表实际超时或强制等待时长。

## 动效与接入边界

鲸鱼宽 96、高 72，品牌字标宽 160、高 29，状态文字 13，底部说明 11；主体垂直居中并向上偏移 28。近黑背景 `#0B0C0E`，浅色背景 `#FAFAF9`，光点 `#4D6BFE`。

首次入场 0.55 秒：鲸鱼从下方 6px 淡入，标题延迟 0.12 秒。等待时鲸鱼以 2.4 秒周期上下轻浮 2px，三颗 4px 光点以 1.5 秒周期错峰明暗变化。退出 0.24 秒：整体淡出并上移 2px。启用减少动态效果时取消入场、循环和位移，状态保持静态。

HTML 通过 `document.body.dataset.state` 接收外部状态：`connecting` 显示「正在连接你的电脑」，`opening` 显示「正在打开工作区」，`ready` 执行退出。无自动完成计时，不模拟连接成功。深浅色默认跟随系统，也可用 `document.body.dataset.theme` 设为 `dark` 或 `light`。

原生接入沿用现有导航回调：开始加载时入场、收到页面内容后更新状态、加载完成后退出、失败时立即切换错误页，不因动效增加最短等待。HTML 预览没有接入真实网络，也没有模拟成功后的工作区。原生间距、颜色、安全区与动效说明见 `../DESIGN.md`；`../Checks/startup.sh` 可验证生产视图布局与重播，`../Checks/launch.sh` 验证真实导航生命周期。

## 已验证

无界面 Chromium 已检查深浅色、鲸鱼浮动、状态切换、退出透明度、减少动态效果、320×568 小屏与 740×320 横屏，未发现溢出或脚本错误。旧版缺失样式的 Sleek 导出在背景断言上确实失败。已查看深浅色截图并与 Sleek 完整截图核对。

原始设计同步基线 `8235013`；原生接入基线 `17ab8fb`，均无冲突。原生接入后 iOS 模拟器 Debug 构建与 `npm run check` 均通过，后者包括构建、类型检查和 252 项测试。

原生检查通过深浅色、最大辅助字号、320×568 小屏、740×320 横屏、小屏最大字号、实际开启减少动态效果共七种场景，同时验证立即隐藏、退出中重播及结束后清除动画。八种导航检查通过：慢响应、快速加载、慢脚本、失败重试、凭据拒绝、离线、首次未配对和 HTTP 502。快速加载约 0.7 秒退出，没有强制等入场动效结束。旧实现运行新增字标验收时确实失败。深色真实 App 冷启动录屏 258 帧，白帧为 0，中央区域最高亮度 0.324（白帧阈值 0.85）。未在真机安装或验证公网连接。
