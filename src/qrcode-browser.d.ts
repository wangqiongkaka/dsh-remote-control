declare module 'qrcode/lib/browser.js' {
  import type * as QRCode from 'qrcode'
  const browserQrCode: typeof QRCode
  export default browserQrCode
}
