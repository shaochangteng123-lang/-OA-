export interface SignaturePixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProcessedSignaturePixels {
  pixels: Uint8ClampedArray;
  bounds: SignaturePixelBounds;
  inkPixels: number;
}

interface SignatureComponent extends SignaturePixelBounds {
  id: number;
  area: number;
  strengthSum: number;
  boxWidth: number;
  boxHeight: number;
  boxArea: number;
  density: number;
  strokeWidth: number;
  touchesEdge: boolean;
}

interface RankedSignatureComponent extends SignatureComponent {
  averageStrength: number;
  score: number;
}

type SignatureFlow = "horizontal" | "vertical";

interface SignatureComponentSelection {
  labels: Set<number>;
  strengthSum: number;
}

const COMPONENT_THRESHOLD = 64;
const EDGE_THRESHOLD = 18;
const NEIGHBOR_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function luminance(red: number, green: number, blue: number) {
  return red * 0.299 + green * 0.587 + blue * 0.114;
}

function buildInkStrengths(
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
) {
  const totalPixels = width * height;
  let transparentPixels = 0;
  for (let offset = 3; offset < source.length; offset += 4) {
    if (source[offset] < 24) transparentPixels += 1;
  }

  const hasTransparentBackground = transparentPixels > totalPixels * 0.08;
  const strengths = new Uint8Array(totalPixels);
  if (hasTransparentBackground) {
    for (let pixel = 0; pixel < totalPixels; pixel += 1) {
      const alpha = source[pixel * 4 + 3];
      strengths[pixel] = alpha >= EDGE_THRESHOLD ? alpha : 0;
    }
    return { strengths, hasTransparentBackground };
  }

  const values = new Float32Array(totalPixels);
  const integralStride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const alpha = source[offset + 3];
      const value =
        alpha < 12
          ? 255
          : luminance(source[offset], source[offset + 1], source[offset + 2]);
      values[pixel] = value;
      rowSum += value;
      integral[(y + 1) * integralStride + x + 1] =
        integral[y * integralStride + x + 1] + rowSum;
    }
  }

  const radius = clamp(Math.round(Math.min(width, height) * 0.06), 6, 28);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const alpha = source[offset + 3];
      if (alpha < 12) continue;

      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const area = (right - left + 1) * (bottom - top + 1);
      const sum =
        integral[(bottom + 1) * integralStride + right + 1] -
        integral[top * integralStride + right + 1] -
        integral[(bottom + 1) * integralStride + left] +
        integral[top * integralStride + left];
      const localMean = sum / area;
      const localContrast = localMean - values[pixel];
      const normalized = clamp((localContrast - 14) / 52, 0, 1);
      strengths[pixel] = Math.round(normalized * alpha);
    }
  }

  return { strengths, hasTransparentBackground };
}

function findComponents(strengths: Uint8Array, width: number, height: number) {
  const totalPixels = width * height;
  const labels = new Int32Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const components: SignatureComponent[] = [];
  let nextLabel = 0;

  for (let start = 0; start < totalPixels; start += 1) {
    if (strengths[start] < COMPONENT_THRESHOLD || labels[start]) continue;

    nextLabel += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = nextLabel;

    let area = 0;
    let strengthSum = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let perimeter = 0;
    let touchesEdge = false;

    while (head < tail) {
      const pixel = queue[head];
      head += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      strengthSum += strengths[pixel];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesEdge = true;
      }
      if (x === 0 || strengths[pixel - 1] < COMPONENT_THRESHOLD) {
        perimeter += 1;
      }
      if (x === width - 1 || strengths[pixel + 1] < COMPONENT_THRESHOLD) {
        perimeter += 1;
      }
      if (y === 0 || strengths[pixel - width] < COMPONENT_THRESHOLD) {
        perimeter += 1;
      }
      if (y === height - 1 || strengths[pixel + width] < COMPONENT_THRESHOLD) {
        perimeter += 1;
      }

      for (const [offsetX, offsetY] of NEIGHBOR_DIRECTIONS) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
          continue;
        }
        const nextPixel = nextY * width + nextX;
        if (strengths[nextPixel] < COMPONENT_THRESHOLD || labels[nextPixel]) {
          continue;
        }
        labels[nextPixel] = nextLabel;
        queue[tail] = nextPixel;
        tail += 1;
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    components.push({
      id: nextLabel,
      area,
      strengthSum,
      minX,
      minY,
      maxX,
      maxY,
      boxWidth,
      boxHeight,
      boxArea,
      density: area / boxArea,
      strokeWidth: perimeter ? (2 * area) / perimeter : Number.MAX_VALUE,
      touchesEdge,
    });
  }

  return { labels, components };
}

function rankSignatureComponents(
  components: SignatureComponent[],
  width: number,
  height: number,
  hasTransparentBackground: boolean,
) {
  const totalPixels = width * height;
  const minimumArea = Math.max(3, Math.round(totalPixels * 0.00001));
  const maximumStrokeWidth = Math.max(8, Math.min(width, height) * 0.045);

  return components
    .filter(
      (component) =>
        component.area >= minimumArea &&
        component.boxWidth >= 3 &&
        component.boxHeight >= 3 &&
        component.strokeWidth < maximumStrokeWidth &&
        !(component.density > 0.62 && component.area > 30) &&
        (hasTransparentBackground ||
          (!(component.touchesEdge && component.area > minimumArea * 2) &&
            component.area < totalPixels * 0.035 &&
            component.boxArea < totalPixels * 0.55)),
    )
    .map<RankedSignatureComponent>((component) => {
      const averageStrength = component.strengthSum / component.area;
      const centerX = (component.minX + component.maxX) / 2 / width;
      const centerY = (component.minY + component.maxY) / 2 / height;
      const centerDistance = Math.hypot(centerX - 0.5, centerY - 0.5);
      const score =
        averageStrength * 0.65 +
        Math.log1p(component.area) * 16 -
        (component.boxArea / totalPixels) * 100 -
        centerDistance * 8;
      return { ...component, averageStrength, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 500);
}

function selectSignatureComponentsByFlow(
  ranked: RankedSignatureComponent[],
  minimumArea: number,
  flow: SignatureFlow,
): SignatureComponentSelection {
  const seed = ranked[0];
  if (!seed) return { labels: new Set<number>(), strengthSum: 0 };

  const selected = new Set<number>([seed.id]);
  let selectedBounds: SignaturePixelBounds = {
    minX: seed.minX,
    minY: seed.minY,
    maxX: seed.maxX,
    maxY: seed.maxY,
  };
  const minimumNearbyArea = Math.max(minimumArea, Math.ceil(seed.area * 0.03));
  const minimumNearbyStrength = Math.max(135, seed.averageStrength * 0.7);
  let changed = true;

  while (changed) {
    changed = false;
    for (const component of ranked.slice(1)) {
      if (
        selected.has(component.id) ||
        component.averageStrength < minimumNearbyStrength
      ) {
        continue;
      }

      const centerX = (component.minX + component.maxX) / 2;
      const centerY = (component.minY + component.maxY) / 2;
      const insideSelectedBounds =
        centerX >= selectedBounds.minX &&
        centerX <= selectedBounds.maxX &&
        centerY >= selectedBounds.minY &&
        centerY <= selectedBounds.maxY;
      if (!insideSelectedBounds && component.area < minimumNearbyArea) {
        continue;
      }

      const horizontalGap = Math.max(
        0,
        Math.max(selectedBounds.minX, component.minX) -
          Math.min(selectedBounds.maxX, component.maxX) -
          1,
      );
      const verticalGap = Math.max(
        0,
        Math.max(selectedBounds.minY, component.minY) -
          Math.min(selectedBounds.maxY, component.maxY) -
          1,
      );
      const selectedCrossSpan =
        flow === "horizontal"
          ? selectedBounds.maxY - selectedBounds.minY + 1
          : selectedBounds.maxX - selectedBounds.minX + 1;
      const seedCrossSize =
        flow === "horizontal" ? seed.boxHeight : seed.boxWidth;
      const componentCrossSize =
        flow === "horizontal" ? component.boxHeight : component.boxWidth;
      const componentCrossCenter = flow === "horizontal" ? centerY : centerX;
      const seedCrossStart = flow === "horizontal" ? seed.minY : seed.minX;
      const seedCrossEnd = flow === "horizontal" ? seed.maxY : seed.maxX;
      const primaryGap = flow === "horizontal" ? horizontalGap : verticalGap;
      const crossGap = flow === "horizontal" ? verticalGap : horizontalGap;
      const maximumPrimaryGap = Math.max(
        16,
        Math.max(seedCrossSize, componentCrossSize) * 0.85,
      );
      const maximumCrossGap = Math.max(
        6,
        Math.max(selectedCrossSpan, componentCrossSize) * 0.32,
      );
      const seedCrossMargin = Math.max(8, seedCrossSize * 0.75);
      const sharesSignatureBand =
        componentCrossCenter >= seedCrossStart - seedCrossMargin &&
        componentCrossCenter <= seedCrossEnd + seedCrossMargin;

      if (
        sharesSignatureBand &&
        primaryGap <= maximumPrimaryGap &&
        crossGap <= maximumCrossGap
      ) {
        selected.add(component.id);
        selectedBounds = {
          minX: Math.min(selectedBounds.minX, component.minX),
          minY: Math.min(selectedBounds.minY, component.minY),
          maxX: Math.max(selectedBounds.maxX, component.maxX),
          maxY: Math.max(selectedBounds.maxY, component.maxY),
        };
        changed = true;
      }
    }
  }

  const strengthSum = ranked.reduce(
    (sum, component) =>
      selected.has(component.id) ? sum + component.strengthSum : sum,
    0,
  );
  return { labels: selected, strengthSum };
}

function selectSignatureComponents(
  ranked: RankedSignatureComponent[],
  minimumArea: number,
) {
  const horizontal = selectSignatureComponentsByFlow(
    ranked,
    minimumArea,
    "horizontal",
  );
  const vertical = selectSignatureComponentsByFlow(
    ranked,
    minimumArea,
    "vertical",
  );

  return vertical.strengthSum > horizontal.strengthSum * 1.02
    ? vertical.labels
    : horizontal.labels;
}

function restoreSoftEdges(
  strengths: Uint8Array,
  labels: Int32Array,
  selectedLabels: Set<number>,
  width: number,
  height: number,
) {
  const totalPixels = width * height;
  let retained = new Uint8Array(totalPixels);
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    if (selectedLabels.has(labels[pixel])) retained[pixel] = 1;
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const expanded = retained.slice();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (retained[pixel] || strengths[pixel] < EDGE_THRESHOLD) continue;

        for (const [offsetX, offsetY] of NEIGHBOR_DIRECTIONS) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (
            nextX >= 0 &&
            nextY >= 0 &&
            nextX < width &&
            nextY < height &&
            retained[nextY * width + nextX]
          ) {
            expanded[pixel] = 1;
            break;
          }
        }
      }
    }
    retained = expanded;
  }

  return retained;
}

export function extractSignaturePixels(
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): ProcessedSignaturePixels {
  const totalPixels = width * height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    source.length !== totalPixels * 4
  ) {
    throw new Error("签名图片像素数据不正确");
  }

  const { strengths, hasTransparentBackground } = buildInkStrengths(
    source,
    width,
    height,
  );
  const { labels, components } = findComponents(strengths, width, height);
  const ranked = rankSignatureComponents(
    components,
    width,
    height,
    hasTransparentBackground,
  );
  const minimumArea = Math.max(3, Math.round(totalPixels * 0.00001));
  const selectedLabels = selectSignatureComponents(ranked, minimumArea);
  if (!selectedLabels.size) {
    throw new Error("图片中未识别到有效签名笔迹");
  }

  const retained = restoreSoftEdges(
    strengths,
    labels,
    selectedLabels,
    width,
    height,
  );
  const output = new Uint8ClampedArray(totalPixels * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4;
    output[offset] = 255;
    output[offset + 1] = 255;
    output[offset + 2] = 255;
    output[offset + 3] = 0;
    if (!retained[pixel]) continue;

    const strength = strengths[pixel];
    const normalizedAlpha = Math.round(
      255 * Math.pow(clamp(strength / 255, 0, 1), 0.78),
    );
    if (normalizedAlpha < EDGE_THRESHOLD) continue;

    const red = source[offset];
    const green = source[offset + 1];
    const blue = source[offset + 2];
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (chroma >= 44) {
      const darken = 0.58 + 0.16 * (1 - normalizedAlpha / 255);
      output[offset] = Math.round(red * darken);
      output[offset + 1] = Math.round(green * darken);
      output[offset + 2] = Math.round(blue * darken);
    } else {
      const inkColor = Math.round(14 + 24 * (1 - normalizedAlpha / 255));
      output[offset] = inkColor;
      output[offset + 1] = inkColor;
      output[offset + 2] = inkColor;
    }
    output[offset + 3] = normalizedAlpha;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    inkPixels += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (inkPixels < 8 || maxX < minX || maxY < minY) {
    throw new Error("图片中未识别到有效签名笔迹");
  }

  return {
    pixels: output,
    bounds: { minX, minY, maxX, maxY },
    inkPixels,
  };
}

export function shouldRotateSignatureToLandscape(bounds: SignaturePixelBounds) {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  return height > width * 1.12;
}
