/**
 * Renders a DOM node to a PNG and shares (or downloads) it. Implemented with an SVG
 * <foreignObject> snapshot so no third-party rasteriser dependency is needed.
 */
export async function shareNodeAsImage(node: HTMLElement, fileName: string): Promise<void> {
  const blob = await nodeToPngBlob(node);
  if (!blob) return;

  const file = new File([blob], fileName, { type: 'image/png' });
  const canShareFiles =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  if (canShareFiles && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch {
      // The user dismissed the share sheet, or sharing is unavailable - fall through to download.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function nodeToPngBlob(node: HTMLElement): Promise<Blob | null> {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width) || 420;
  const height = Math.ceil(rect.height) || 640;
  const scale = Math.min(3, window.devicePixelRatio || 2);

  const clone = node.cloneNode(true) as HTMLElement;
  inlineComputedStyles(node, clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div>
    </foreignObject>
  </svg>`;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = svgUrl;
  });
  if (!loaded) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);

  return new Promise((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'));
}

/**
 * The SVG snapshot has no access to the page's stylesheets, so every visual property has to be
 * copied inline onto the clone before serialising.
 */
function inlineComputedStyles(source: HTMLElement, target: HTMLElement): void {
  const sourceElements = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const targetElements = [target, ...Array.from(target.querySelectorAll<HTMLElement>('*'))];

  sourceElements.forEach((element, index) => {
    const clone = targetElements[index];
    if (!clone) return;
    const computed = window.getComputedStyle(element);
    let css = '';
    for (const property of PRESERVED_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) css += `${property}:${value};`;
    }
    clone.setAttribute('style', css);
  });
}

const PRESERVED_PROPERTIES = [
  'background',
  'background-color',
  'border',
  'border-radius',
  'box-shadow',
  'color',
  'display',
  'flex-direction',
  'font-family',
  'font-size',
  'font-variant-numeric',
  'font-weight',
  'gap',
  'grid-template-columns',
  'height',
  'justify-content',
  'align-items',
  'letter-spacing',
  'line-height',
  'margin',
  'min-height',
  'opacity',
  'overflow',
  'padding',
  'text-align',
  'text-overflow',
  'white-space',
  'width',
];
