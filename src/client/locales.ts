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
  sidebar: '侧边栏',
  qrUnavailable: '二维码暂不可用，请复制链接在手机上打开。',
  paired: '手机已连接，可在手机上直接使用这个工作区。',
  pairedAnother: '要配对另一台设备，请先停止远程控制。',
  pairedUntil: '访问有效期至',
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
  sidebar: 'Sidebar',
  qrUnavailable: 'QR code unavailable. Copy the link and open it on your phone.',
  paired: 'A phone is connected and can use this workspace directly.',
  pairedAnother: 'To pair another device, stop remote control first.',
  pairedUntil: 'Access expires',
}
