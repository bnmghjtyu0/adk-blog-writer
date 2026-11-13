import { ToolContext, ToolResult, ImageBackend, ImageBackendResult } from './types';

class MockImageBackend implements ImageBackend {
  async render({ sheet, form, reference_seed, reference_png, instruction }: any): Promise<ImageBackendResult> {
    return {
      png: Buffer.from('mock-png-data'),
      identity_hue: '#2563EB', // 科技藍主色調
    };
  }
}

let _backend: ImageBackend = new MockImageBackend();

export function setBackend(b: ImageBackend): void {
  _backend = b;
}

/**
 * 內部渲染包裝器，沿用現有 ImageBackend 介面
 */
async function renderVisual(params: {
  sheet: string;
  form: string;
  reference_seed: string;
  instruction?: string | null;
}): Promise<{ png: Buffer; meta: { form: string; identity_hue: string } }> {
  const result = await _backend.render(params);
  return {
    png: result.png,
    meta: { form: params.form, identity_hue: result.identity_hue },
  };
}

/**
 * 統一儲存圖片至 Artifact Store 並回傳 Markdown 嵌入語法
 */
async function saveBlogArtifact(
  png: Buffer,
  prefix: string,
  caption: string,
  toolContext: ToolContext
): Promise<{ filename: string; markdown: string }> {
  const history = toolContext.state['blog_images'] || [];
  const index = history.length;
  const filename = `${prefix}_${index}.png`;

  // 儲存至 Google ADK Artifact Store（必須轉為 base64）
  await toolContext.saveArtifact(filename, {
    inlineData: {
      mimeType: 'image/png',
      data: png.toString('base64'),
    },
  });

  const record = { filename, caption, index };
  toolContext.state['blog_images'] = [...history, record];

  return {
    filename,
    markdown: `![${caption}](${filename})`,
  };
}

/**
 * 工具 1：生成技術架構圖、硬體藍圖或系統流程圖
 */
export async function generateTechnicalDiagram(
  prompt: string,
  style: 'blueprint' | 'infographic' | 'schematic',
  caption: string,
  toolContext: ToolContext
): Promise<ToolResult> {
  const { png, meta } = await renderVisual({
    sheet: prompt,
    form: `technical ${style} diagram`,
    reference_seed: `diagram-${Date.now()}`,
    instruction: `Clean modern technical ${style} illustration, white or dark slate background, clear visual hierarchy, high resolution, no gibberish text: ${prompt}`,
  });

  const { filename, markdown } = await saveBlogArtifact(png, 'diagram', caption, toolContext);

  return {
    status: 'ok',
    artifact: filename,
    caption,
    markdown_embed: markdown,
    identity_hue: meta.identity_hue,
    outputArtifacts: [{ name: filename, mimeType: 'image/png' }],
  };
}

/**
 * 工具 2：生成市場比較圖、生態系循環圖或封面橫幅
 */
export async function generateMarketVisual(
  topic: string,
  visualType: 'ecosystem_loop' | 'comparison_chart' | 'hero_banner',
  caption: string,
  toolContext: ToolContext
): Promise<ToolResult> {
  const { png, meta } = await renderVisual({
    sheet: topic,
    form: `editorial ${visualType}`,
    reference_seed: `visual-${Date.now()}`,
    instruction: `Editorial tech blog ${visualType} illustration, sleek modern design, clean composition, minimal abstract visual style: ${topic}`,
  });

  const { filename, markdown } = await saveBlogArtifact(png, 'visual', caption, toolContext);

  return {
    status: 'ok',
    artifact: filename,
    caption,
    markdown_embed: markdown,
    identity_hue: meta.identity_hue,
    outputArtifacts: [{ name: filename, mimeType: 'image/png' }],
  };
}