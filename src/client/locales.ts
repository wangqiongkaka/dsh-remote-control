/** Product copy for the optional remote-control dialog. */

export const NS = 'remote-control'

/** Chinese UI copy for pairing and tunnel control. */
export const zh = {
  title: '移动端远程控制',
  description: '扫码或在手机上打开链接，即可进入当前工作区。配对后可使用完整 DSH Web 界面。',
  loading: '正在开启安全隧道…',
  copy: '复制链接',
  copied: '已复制',
  stop: '停止远程控制',
  close: '关闭',
  error: '无法开启远程控制',
  retry: '重试',
  oneUse: '链接只能配对一次。若需重新配对，请停止后重新开启。',
  qrUnavailable: '二维码暂不可用，请复制链接在手机上打开。',
  landingTitle: '工作区会话',
  landingEmpty: '这个工作区还没有会话。',
  landingMissing: '工作区已不存在。',
} as const

/** Keys shared by the remote-control dictionaries. */
export type RemoteControlKey = keyof typeof zh

/** English UI copy for pairing and tunnel control. */
export const en: Record<RemoteControlKey, string> = {
  title: 'Mobile remote control',
  description: 'Scan or open the link on your phone to enter this workspace. Paired devices can use the full DSH Web UI.',
  loading: 'Starting secure tunnel…',
  copy: 'Copy link',
  copied: 'Copied',
  stop: 'Stop remote control',
  close: 'Close',
  error: 'Could not start remote control',
  retry: 'Retry',
  oneUse: 'The link pairs one device. Stop and start again to pair another device.',
  qrUnavailable: 'QR code unavailable. Copy the link and open it on your phone.',
  landingTitle: 'Workspace sessions',
  landingEmpty: 'This workspace has no sessions yet.',
  landingMissing: 'This workspace no longer exists.',
}
