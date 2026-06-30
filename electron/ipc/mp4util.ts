import fs from 'node:fs';
import crypto from 'node:crypto';

// Дозапись валидного MP4-атома 'free' со случайным содержимым: меняет хэш файла,
// НЕ ломая контейнер (декодеры пропускают free-боксы). Сырые случайные байты в
// конец mp4 строгие декодеры (TikTok) считают повреждением -> «Couldn't decode».
export async function appendFreeAtom(filePath: string): Promise<void> {
  const payload = crypto.randomBytes(512 + Math.floor(Math.random() * 1537)); // 512..2048
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0); // размер бокса (вкл. заголовок)
  header.write('free', 4, 'ascii');
  await fs.promises.appendFile(filePath, Buffer.concat([header, payload]));
}
