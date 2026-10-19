# iOS 连接失败页

来源：[Sleek 项目](https://sleek.design/project/Q9BriRwhx9z)，屏幕 `AlCux9WOYVk`，组件 `oKGf79esVoA`，版本 `Vw1sEfgbapo`。设计 HTML、首屏图和完整预览保存在 `Design/`。

- 只替换连接失败状态；首次配对、凭据拒绝页、正常网页和启动动画沿用原有行为。
- 全屏布局：顶部 44pt 品牌栏，中间可滚动的错误说明，底部主按钮及并排次按钮；左右 24pt，按钮间距 12pt，底部使用系统安全区。
- 标题 24pt semibold，说明 15pt，错误信息与配对提示 13pt；系统字体随动态字体调整。设计导出中的 `font-heading` 仍引用项目字体，原生实现遵循本次设计要求使用系统字体，不下载远程字体。
- 深色：背景 `#0B0C0E`，表面 `#17181B`，提示表面 `#121316`，主文字 `#F2F3F5`，次文字 `#9A9FA6`，弱文字 `#7D828A`，边框 `#2A2C30`，主按钮 `#0A84FF`。浅色沿用项目主题的对应颜色。
- 断线图标容器 64pt、圆角 18pt；按钮圆角 14pt，主按钮至少 52pt，次按钮至少 48pt。字号增大时允许按钮和内容自然增高。
- 图标采用设计原 SVG 和官方 `@iconify-json/ph` 中的 `warning-circle`、`info`、`qr-code`、`link-simple`，以本地矢量资产提供。
- Phosphor 图标许可见 `Design/ICON-LICENSE.txt`。`Design/connection-error-native.png` 和 `Design/connection-error-native-light.png` 为原生生产视图的模拟器截图，使用完整按钮状态；真实扫描仅在支持该能力的设备显示。
- HTTP 信息显示真实状态码；网络失败显示系统实际错误；不写死超时时间。重试重复原失败地址，扫码和粘贴沿用现有权限与校验。扫描不可用的设备保持原有隐藏行为。
