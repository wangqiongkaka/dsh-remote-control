# 启动动画设计方案

来源：[Sleek 项目](https://sleek.design/project/Q9BriRwhx9z)。屏幕 `YUWNUSbCRnc`，组件 `1GSEkUbL9Rt`，静态设计版本 5（`vzfNdKu4mc5`），生成任务 `aRb0q4IvRhr`。

本次只交付设计与 HTML 预览，未修改 `StartupView.swift` 或原生加载流程。设计以现有鲸鱼标志、品牌矢量字标和黑白配色为基础，说明文字使用系统字体，品牌蓝只用于三颗连接光点。

- `deepseek-wordmark.svg`：按用户参考图采用全小写品牌字形，只读提取自现有宿主的 `packages/client/ui-primitives/src/BrandWordmark.tsx`；只保留文字的 9 个原始路径，不含鲸鱼或 HARNESS 徽标。预览以内联 SVG 使用该字标，颜色随深浅色变化，不依赖字体下载；宿主文件未修改。
- `startup-animation.html`：Sleek 原始静态导出；平台未保留自定义动画样式。
- `startup-animation-design.png`、`startup-animation-review.png`：Sleek 首屏与完整核对截图。
- `startup-project-overview.png`：当前项目全部页面全览；另外两个页面未修改。
- `startup-animation-preview.html`：无外部依赖的可运行动画；可直接打开，默认持续显示连接等待。
- `startup-animation-preview.png`、`startup-animation-light.png`：无界面浏览器的深浅色预览截图。
- `startup-animation.gif`：演示入场、连接等待、打开工作区与淡出的动图。录制中约三秒后切换状态，仅为演示，不代表实际超时或强制等待时长。

## 动效与接入边界

鲸鱼宽 96、高 72，品牌字标宽 160、高 29，状态文字 13，底部说明 11；主体垂直居中并向上偏移 28。近黑背景 `#0B0C0E`，浅色背景 `#FAFAF9`，光点 `#4D6BFE`。

首次入场 0.55 秒：鲸鱼从下方 6px 淡入，标题延迟 0.12 秒。等待时鲸鱼以 2.4 秒周期上下轻浮 2px，三颗 4px 光点以 1.5 秒周期错峰明暗变化。退出 0.24 秒：整体淡出并上移 2px。启用减少动态效果时取消入场、循环和位移，状态保持静态。

HTML 通过 `document.body.dataset.state` 接收外部状态：`connecting` 显示「正在连接你的电脑」，`opening` 显示「正在打开工作区」，`ready` 执行退出。无自动完成计时，不模拟连接成功。深浅色默认跟随系统，也可用 `document.body.dataset.theme` 设为 `dark` 或 `light`。

正式接入时应继续沿用现有导航回调：开始加载时入场、收到页面内容后更新状态、加载完成后退出、失败时立即切换错误页，不因动效增加最短等待。预览没有接入真实网络，也没有模拟成功后的工作区。

## 已验证

无界面 Chromium 已检查深浅色、鲸鱼浮动、状态切换、退出透明度、减少动态效果、320×568 小屏与 740×320 横屏，未发现溢出或脚本错误。旧版缺失样式的 Sleek 导出在背景断言上确实失败。已查看深浅色截图并与 Sleek 完整截图核对。

同步基线 `8235013`，无冲突。项目 `npm run check` 通过：构建、类型检查和 252 项测试。本次未改原生 App，因此未运行原生构建或模拟器视觉验证；尚未接入原生 App。
