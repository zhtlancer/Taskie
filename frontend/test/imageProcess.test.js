import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLaplacianSharpen,
  enhanceContrastAndPaper,
  applyAdaptiveBinarize,
  cropCanvasRegion,
  createRotatedCanvas,
  processCanvasWithFilter
} from '../src/utils/imageProcess.js';

// Polyfill minimal ImageData and Canvas for Node test environment
class MockImageData {
  constructor(dataOrWidth, widthOrHeight, maybeHeight) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = maybeHeight;
    } else {
      this.width = dataOrWidth;
      this.height = widthOrHeight;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}
globalThis.ImageData = MockImageData;

class MockCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }
  getImageData(sx, sy, sw, sh) {
    return new MockImageData(new Uint8ClampedArray(this.buffer), sw, sh);
  }
  putImageData(imageData, dx, dy) {
    this.buffer.set(imageData.data);
  }
  translate(x, y) {}
  rotate(angle) {}
  drawImage(source, ...args) {}
  clearRect(x, y, w, h) {
    this.buffer.fill(0);
  }
}

class MockCanvas {
  constructor(width = 300, height = 150) {
    this.width = width;
    this.height = height;
    this._ctx = new MockCanvasContext(this);
  }
  getContext(type) {
    return this._ctx;
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return new MockCanvas();
    return {};
  }
};

describe('Image Processing & Filter Utilities', () => {
  test('Laplacian 3x3 sharpening enhances edges and contrast', () => {
    const canvas = new MockCanvas(5, 5);
    const ctx = canvas.getContext('2d');
    
    // Create an edge in the image: row 0, 1 are bright (200), row 2, 3, 4 are dark (50)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = (y * 5 + x) * 4;
        const val = y < 2 ? 200 : 50;
        ctx.buffer[idx] = val;
        ctx.buffer[idx + 1] = val;
        ctx.buffer[idx + 2] = val;
        ctx.buffer[idx + 3] = 255;
      }
    }

    // Apply sharpening
    applyLaplacianSharpen(ctx, 5, 5, 0.65);

    const result = ctx.getImageData(0, 0, 5, 5);
    // At row 1 (bright side of edge), value should be sharpened higher than 200
    const edgeBrightIdx = (1 * 5 + 2) * 4;
    assert.ok(result.data[edgeBrightIdx] >= 200, 'Bright side of edge should be boosted');

    // At row 2 (dark side of edge), value should be sharpened lower than 50
    const edgeDarkIdx = (2 * 5 + 2) * 4;
    assert.ok(result.data[edgeDarkIdx] <= 50, 'Dark side of edge should be darkened');
  });

  test('Contrast enhancement whitens paper background and deepens dark ink', () => {
    const canvas = new MockCanvas(10, 10);
    const ctx = canvas.getContext('2d');

    // 85% grayish paper (215, 210, 205), 15% dark handwriting (45, 45, 45)
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      const isInk = i < 15;
      const r = isInk ? 45 : 215;
      const g = isInk ? 45 : 210;
      const b = isInk ? 45 : 205;
      ctx.buffer[idx] = r;
      ctx.buffer[idx + 1] = g;
      ctx.buffer[idx + 2] = b;
      ctx.buffer[idx + 3] = 255;
    }

    enhanceContrastAndPaper(ctx, 10, 10);

    const result = ctx.getImageData(0, 0, 10, 10);
    // Paper pixel (e.g. index 50) should be whitened towards 255
    const paperIdx = 50 * 4;
    assert.ok(result.data[paperIdx] >= 240, 'Paper background should be whitened');
    assert.ok(result.data[paperIdx + 1] >= 240, 'Paper green channel whitened');
    assert.ok(result.data[paperIdx + 2] >= 240, 'Paper blue channel whitened');

    // Ink pixel should stay dark
    const inkIdx = 5 * 4;
    assert.ok(result.data[inkIdx] <= 50, 'Handwriting should remain dark');
  });

  test('Bradley-Roth adaptive binarization binarizes text to 0 (black) and paper to 255 (white)', () => {
    const canvas = new MockCanvas(10, 10);
    const ctx = canvas.getContext('2d');

    // Paper around 200, text in middle pixels around 40
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (y * 10 + x) * 4;
        const isText = (x === 4 || x === 5) && (y >= 3 && y <= 6);
        const val = isText ? 40 : 200;
        ctx.buffer[idx] = val;
        ctx.buffer[idx + 1] = val;
        ctx.buffer[idx + 2] = val;
        ctx.buffer[idx + 3] = 255;
      }
    }

    applyAdaptiveBinarize(ctx, 10, 10, 0.4, 0.14);

    const result = ctx.getImageData(0, 0, 10, 10);
    // Center text pixel (4, 4) should be 0 (pure black)
    const textIdx = (4 * 10 + 4) * 4;
    assert.equal(result.data[textIdx], 0, 'Text pixel should be pure black (0)');

    // Background pixel (1, 1) should be 255 (pure white)
    const bgIdx = (1 * 10 + 1) * 4;
    assert.equal(result.data[bgIdx], 255, 'Background paper should be pure white (255)');
  });

  test('processCanvasWithFilter supports original, enhanced, and bw modes', () => {
    const srcCanvas = new MockCanvas(8, 8);
    const resOrig = processCanvasWithFilter(srcCanvas, 'original');
    assert.equal(resOrig.width, 8);
    assert.equal(resOrig.height, 8);

    const resEnhanced = processCanvasWithFilter(srcCanvas, 'enhanced');
    assert.equal(resEnhanced.width, 8);
    assert.equal(resEnhanced.height, 8);

    const resBw = processCanvasWithFilter(srcCanvas, 'bw');
    assert.equal(resBw.width, 8);
    assert.equal(resBw.height, 8);
  });
});
