import qrcode from "qrcode-terminal";

export type PairingDisplay = {
  expiresAt: string;
  pairingLink: string;
  qrCode?: string;
};

export function renderPairingQr(pairingLink: string): string {
  let rendered = "";
  qrcode.generate(pairingLink, { small: true }, (qr) => {
    rendered = qr.trimEnd();
  });
  return rendered;
}

export function formatPairingDisplay(display: PairingDisplay): string[] {
  return [
    "Scan with Pi iOS app:",
    display.qrCode ?? renderPairingQr(display.pairingLink),
    `Expires at: ${display.expiresAt}`,
  ];
}
