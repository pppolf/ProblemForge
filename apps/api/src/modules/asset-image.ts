import { HttpError } from '@problemforge/domain';

export function assetPath(asset: { id: string; mediaType: string }) {
  return `assets/${asset.id}.${asset.mediaType === 'image/png' ? 'png' : 'jpg'}`;
}

// Use the same byte validation for problem and contest images; never trust the
// filename or a browser-supplied MIME type to select executable content.
export function readAssetImage(base64: string) {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 1_000_000 || bytes.toString('base64') !== base64) throw new HttpError(422, '图片必须是规范 Base64 且不超过 1MB');
  let mediaType: string;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.subarray(12, 16).toString() === 'IHDR') {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 16_000_000) throw new HttpError(422, 'PNG 图像尺寸超出范围');
    mediaType = 'image/png';
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.subarray(-2).equals(Buffer.from([255, 217]))) mediaType = 'image/jpeg';
  else throw new HttpError(422, '资源支持 PNG / JPEG；不接受 SVG、脚本或 TeX 文件');
  return { bytes, mediaType };
}
