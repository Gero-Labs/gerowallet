/**
 * Draws the verification QR (`verificationQrPayload`) for a cosigner to scan in person. Dark
 * modules on a light quiet zone whatever the theme: phone cameras read that contrast best.
 */
const DARK = '#000000';
const LIGHT = '#ffffff';

export async function drawVerificationQr(canvas: HTMLCanvasElement, payload: string, width = 200): Promise<void> {
  const QRCode = await import('qrcode');
  await QRCode.toCanvas(canvas, payload, { width, margin: 2, errorCorrectionLevel: 'M', color: { dark: DARK, light: LIGHT } });
}
