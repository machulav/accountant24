const CURRENCY_FRAMES = ["$", "€", "£", "¥", "₴"];

export function updateDisplay(this: Record<string, any>) {
  const frame = CURRENCY_FRAMES[Math.floor(this.currentFrame / 2) % CURRENCY_FRAMES.length];
  this.setText(`\x1b[32m${frame}\x1b[0m ${this.messageColorFn(this.message)}`);
  this.ui?.requestRender();
}
