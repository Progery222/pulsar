// Метка нажатой клавиши (vk + маска модификаторов) для оверлея «показ клавиш».
const VK: Record<number, string> = {
  8: '⌫', 9: 'Tab', 13: '⏎', 27: 'Esc', 32: 'Space', 45: 'Ins', 46: 'Del',
  33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home', 37: '←', 38: '↑', 39: '→', 40: '↓',
};

export function keyLabel(vk: number, mask: number): string {
  let base = VK[vk];
  if (!base) {
    if (vk >= 48 && vk <= 57) base = String.fromCharCode(vk); // 0-9
    else if (vk >= 65 && vk <= 90) base = String.fromCharCode(vk); // A-Z
    else if (vk >= 112 && vk <= 123) base = 'F' + (vk - 111); // F1-F12
    else base = '?';
  }
  const mods: string[] = [];
  if (mask & 1) mods.push('Ctrl');
  if (mask & 2) mods.push('Shift');
  if (mask & 4) mods.push('Alt');
  if (mask & 8) mods.push('Win');
  return [...mods, base].join(' + ');
}
