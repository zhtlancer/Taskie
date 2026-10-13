/**
 * 图像处理核心算法库 (针对试卷、作业错题图像裁剪、锐化、二值化与压缩)
 */

/**
 * 顺时针旋转图片指定角度 (0, 90, 180, 270)
 * @param {HTMLImageElement|HTMLCanvasElement} source 
 * @param {number} degrees 
 * @returns {HTMLCanvasElement}
 */
export function createRotatedCanvas(source, degrees = 0) {
  const normDeg = ((degrees % 360) + 360) % 360;
  const isSwap = normDeg === 90 || normDeg === 270;
  const targetW = isSwap ? source.height : source.width;
  const targetH = isSwap ? source.width : source.height;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.translate(targetW / 2, targetH / 2);
  ctx.rotate((normDeg * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);

  return canvas;
}

/**
 * 截取源画布指定矩形区域，自动限制最大边长以优化处理性能与内存占用
 * @param {HTMLCanvasElement} sourceCanvas 
 * @param {{x: number, y: number, width: number, height: number}} cropRect 
 * @param {number} maxDimension 
 * @returns {HTMLCanvasElement}
 */
export function cropCanvasRegion(sourceCanvas, cropRect, maxDimension = 1400) {
  let { x, y, width, height } = cropRect;
  x = Math.max(0, Math.min(x, sourceCanvas.width - 1));
  y = Math.max(0, Math.min(y, sourceCanvas.height - 1));
  width = Math.max(10, Math.min(width, sourceCanvas.width - x));
  height = Math.max(10, Math.min(height, sourceCanvas.height - y));

  // 等比例缩放至最大边不超过 maxDimension
  let outW = width;
  let outH = height;
  const maxSide = Math.max(width, height);
  if (maxSide > maxDimension) {
    const scale = maxDimension / maxSide;
    outW = Math.round(width * scale);
    outH = Math.round(height * scale);
  }

  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = outW;
  croppedCanvas.height = outH;
  const ctx = croppedCanvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, outW, outH);
  return croppedCanvas;
}

/**
 * 应用拉普拉斯 3x3 锐化算子
 * 强化铅笔、钢笔字迹的边缘与细节
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} width 
 * @param {number} height 
 * @param {number} strength 默认 0.65
 */
export function applyLaplacianSharpen(ctx, width, height, strength = 0.65) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const output = new Uint8ClampedArray(data.length);
  output.set(data);

  const w4 = width * 4;
  const centerWeight = 1 + 4 * strength;
  const edgeWeight = -strength;

  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * w4;
    const prevRowOffset = (y - 1) * w4;
    const nextRowOffset = (y + 1) * w4;

    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + (x << 2);
      const topIdx = prevRowOffset + (x << 2);
      const btmIdx = nextRowOffset + (x << 2);
      const lftIdx = idx - 4;
      const rgtIdx = idx + 4;

      for (let c = 0; c < 3; c++) {
        const val =
          data[idx + c] * centerWeight +
          (data[topIdx + c] + data[btmIdx + c] + data[lftIdx + c] + data[rgtIdx + c]) * edgeWeight;
        output[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      output[idx + 3] = data[idx + 3]; // 保持 Alpha
    }
  }

  const resultImageData = new ImageData(output, width, height);
  ctx.putImageData(resultImageData, 0, 0);
}

/**
 * 对比度自适应增强与白纸底色去灰
 * 去除阴影与泛黄环境光，保留笔迹色彩
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} width 
 * @param {number} height 
 */
export function enhanceContrastAndPaper(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  // 1. 统计亮度直方图
  const hist = new Int32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[lum]++;
  }

  // 2. 自适应计算黑白锚点 (黑点分位数 ~5%，白纸分位数 ~80%)
  let count = 0;
  let blackPoint = 35;
  let whitePoint = 205;
  const p5 = Math.floor(totalPixels * 0.05);
  const p80 = Math.floor(totalPixels * 0.80);

  for (let i = 0; i < 256; i++) {
    count += hist[i];
    if (count >= p5 && blackPoint === 35) {
      blackPoint = Math.min(Math.max(i, 15), 70);
    }
    if (count >= p80) {
      whitePoint = Math.max(Math.min(i, 245), 180);
      break;
    }
  }

  if (whitePoint <= blackPoint + 20) {
    blackPoint = 30;
    whitePoint = 210;
  }

  const range = whitePoint - blackPoint;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    if (i <= blackPoint) {
      lut[i] = 0;
    } else if (i >= whitePoint) {
      lut[i] = 255;
    } else {
      const norm = (i - blackPoint) / range;
      lut[i] = Math.pow(norm, 0.88) * 255;
    }
  }

  // 3. 映射色阶并漂白背景
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const newLum = lut[lum];

    if (newLum >= 238) {
      // 达到白纸阈值，纯白呈现
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    } else {
      const factor = newLum / Math.max(lum, 1);
      data[i] = Math.min(255, Math.max(0, Math.round(r * factor * 0.9 + newLum * 0.1)));
      data[i + 1] = Math.min(255, Math.max(0, Math.round(g * factor * 0.9 + newLum * 0.1)));
      data[i + 2] = Math.min(255, Math.max(0, Math.round(b * factor * 0.9 + newLum * 0.1)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * 黑白文档模式 (Bradley-Roth 积分图自适应阈值灰度二值化)
 * 仿扫描全能王，纸张背景纯白、字迹加黑
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} width 
 * @param {number} height 
 */
export function applyAdaptiveBinarize(ctx, width, height, windowFraction = 0.045, thresholdRatio = 0.13) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 1. 转灰度
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 2. 积分图计算
  const intW = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOffset = (y + 1) * intW;
    const prevRowOffset = y * intW;
    const grayRowOffset = y * width;
    for (let x = 0; x < width; x++) {
      rowSum += gray[grayRowOffset + x];
      integral[rowOffset + (x + 1)] = integral[prevRowOffset + (x + 1)] + rowSum;
    }
  }

  // 3. 局部窗口自适应二值化
  const s = Math.max(16, Math.round(Math.min(width, height) * windowFraction));
  const sHalf = Math.floor(s / 2);

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - sHalf);
    const y2 = Math.min(height, y + sHalf + 1);
    const rowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - sHalf);
      const x2 = Math.min(width, x + sHalf + 1);
      const count = (x2 - x1) * (y2 - y1);
      const sum =
        integral[y2 * intW + x2] -
        integral[y1 * intW + x2] -
        integral[y2 * intW + x1] +
        integral[y1 * intW + x1];

      const currentPixel = gray[rowOffset + x];
      // 当当前像素显著暗于局部均值时判定为笔迹/字迹
      const isBlack = currentPixel * count < sum * (1 - thresholdRatio);
      const val = isBlack ? 0 : 255;

      const idx = (rowOffset + x) << 2;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * 滤镜生成器
 * @param {HTMLCanvasElement} croppedCanvas 
 * @param {'original'|'enhanced'|'bw'} filterMode 
 * @returns {HTMLCanvasElement}
 */
export function processCanvasWithFilter(croppedCanvas, filterMode = 'enhanced') {
  const canvas = document.createElement('canvas');
  canvas.width = croppedCanvas.width;
  canvas.height = croppedCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(croppedCanvas, 0, 0);

  if (filterMode === 'original') {
    return canvas;
  }

  if (filterMode === 'enhanced') {
    // 默认推荐：对比度自适应提升 + 白纸去灰 + 拉普拉斯 3x3 锐化算子
    enhanceContrastAndPaper(ctx, canvas.width, canvas.height);
    applyLaplacianSharpen(ctx, canvas.width, canvas.height, 0.65);
    return canvas;
  }

  if (filterMode === 'bw') {
    // 黑白文档模式：自适应阈值灰度二值化
    applyAdaptiveBinarize(ctx, canvas.width, canvas.height);
    return canvas;
  }

  return canvas;
}

/**
 * 客户端高效压缩并导出为 WebP / JPEG (体积控制在 150KB ~ 300KB)
 * @param {HTMLCanvasElement} canvas 
 * @returns {Promise<{blob: Blob, file: File, dataUrl: string, mimeType: string, size: number}>}
 */
export async function compressCanvas(canvas) {
  let mimeType = 'image/webp';
  let quality = 0.85;

  let blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));

  // 兜底回退为 JPEG
  if (!blob || blob.type !== 'image/webp') {
    mimeType = 'image/jpeg';
    blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  }

  // 若尺寸超出 320KB，自动微调质量至 0.78
  if (blob && blob.size > 320 * 1024) {
    quality = 0.78;
    const reBlob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (reBlob) blob = reBlob;
  }

  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const fileName = `mistake_${Date.now()}.${ext}`;
  const file = new File([blob], fileName, { type: mimeType });
  const dataUrl = canvas.toDataURL(mimeType, quality);

  return {
    blob,
    file,
    dataUrl,
    mimeType,
    size: blob.size
  };
}
