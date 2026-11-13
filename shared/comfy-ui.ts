import { ImageBackend, ImageBackendResult } from '../ts-grove-agent/types';

// 阿里巴巴模型 z-image-turbo
const gptImageJsonUrl = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/image_z_image_turbo.json";

// chatGPT
// const gptImageJsonUrl = "https://github.com/Comfy-Org/workflow_templates/blob/main/templates/api_openai_gpt_image_2_t2i.json";

export class ComfyUIBackend implements ImageBackend {
  private baseUrl: string;
  private rawJsonUrl: string;
  private templatePrompt: any = null;

  constructor(
    baseUrl: string = 'http://127.0.0.1:8188',
    // 使用 Raw GitHub 連結直接抓取線上 JSON 檔
    rawJsonUrl: string = gptImageJsonUrl
  ) {
    this.baseUrl = baseUrl;
    this.rawJsonUrl = rawJsonUrl;
  }

  // 初始化線上載入範本
  private async ensureTemplateLoaded(): Promise<void> {
    if (this.templatePrompt) return;

    try {
      const response = await fetch(this.rawJsonUrl);
      if (!response.ok) {
        throw new Error(`無法下載線上 JSON: ${response.statusText}`);
      }
      const rawData = await response.json();

      // 如果下載下來的已經是 API 格式，直接使用
      if (!rawData.nodes) {
        this.templatePrompt = rawData;
        return;
      }

      // 如果是 GitHub 上的 UI 範本格式，動態建構 API 格式的 Prompt
      this.templatePrompt = {
        "28": {
          class_type: "UNETLoader",
          inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }
        },
        "30": {
          class_type: "CLIPLoader",
          inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }
        },
        "29": {
          class_type: "VAELoader",
          inputs: { vae_name: "ae.safetensors" }
        },
        "11": {
          class_type: "ModelSamplingAuraFlow",
          inputs: { model: ["28", 0], shift: 3 }
        },
        "27": {
          class_type: "CLIPTextEncode",
          inputs: { text: "", clip: ["30", 0] }
        },
        "33": {
          class_type: "ConditioningZeroOut",
          inputs: { conditioning: ["27", 0] }
        },
        "13": {
          class_type: "EmptySD3LatentImage",
          inputs: { width: 512, height: 512, batch_size: 1 }
        },
        "3": {
          class_type: "KSampler",
          inputs: {
            seed: 0,
            control_after_generate: "randomize",
            steps: 4,
            cfg: 1.0,
            sampler_name: "euler",
            scheduler: "sgm_uniform",
            denoise: 1.0,
            model: ["11", 0],
            positive: ["27", 0],
            negative: ["33", 0],
            latent_image: ["13", 0]
          }
        },
        "8": {
          class_type: "VAEDecode",
          inputs: { samples: ["3", 0], vae: ["29", 0] }
        },
        "9": {
          class_type: "SaveImage",
          inputs: { filename_prefix: "z-image-turbo", images: ["8", 0] }
        }
      };
    } catch (err) {
      throw new Error(`載入線上 ComfyUI 範本失敗: ${err}`);
    }
  }

  async render(params: {
    sheet: string;
    form: string;
    reference_seed: string;
    reference_png?: Buffer | null;
    instruction?: string | null;
  }): Promise<ImageBackendResult> {
    // 確保線上 JSON 範本已載入
    await this.ensureTemplateLoaded();

    const style =
      'Cute low-poly art style — faceted geometric shapes with soft flat shading, in the ' +
      'gentle Monument Valley / Alto\'s Odyssey aesthetic. Big soft expressive eyes, a sweet ' +
      'friendly face, warm pastel colours, soft gradient light, sitting on a small glowing ' +
      'cloud, plain pastel background, centered, charming and adorable. No text, no logos.';

    let prompt = '';
    if (params.instruction) {
      prompt = `${params.instruction} ${style}`;
    } else if (params.reference_png) {
      prompt = `A low-poly animal familiar wearing ${params.form}, maintaining identical face and character design based on: ${params.sheet}. ${style}`;
    } else {
      prompt = `Create a BRAND-NEW animal spirit familiar (a little creature — fox, cat, owl, dragon, deer, bunny, etc., never a human) in an adorable cute low-poly look based on: ${params.sheet}. ${style}`;
    }

    // 深拷貝範本結構
    const workflow = JSON.parse(JSON.stringify(this.templatePrompt));

    // 動態填入參數
    workflow["27"].inputs.text = prompt;
    workflow["3"].inputs.seed = parseInt(params.reference_seed.replace(/[^0-9]/g, '') || '0');

    // 提交 Prompt 至 ComfyUI
    const promptResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!promptResponse.ok) {
      throw new Error(`ComfyUI prompt submission failed: ${promptResponse.statusText}`);
    }

    const { prompt_id } = await promptResponse.json();

    // 輪詢等待生成結果
    let imageBuffer: Buffer | null = null;
    while (!imageBuffer) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const historyResponse = await fetch(`${this.baseUrl}/history/${prompt_id}`);
      const history = await historyResponse.json();

      const output = history[prompt_id] && 
               history[prompt_id].outputs && 
               history[prompt_id].outputs["9"] && 
               history[prompt_id].outputs["9"].images && 
               history[prompt_id].outputs["9"].images[0];
      if (output) {
        const imageResponse = await fetch(`${this.baseUrl}/view?filename=${output.filename}&subfolder=${output.subfolder}&type=${output.type || 'output'}`);
        const arrayBuffer = await imageResponse.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      }
    }

    return {
      png: imageBuffer!,
      identity_hue: '#FF0000',
    };
  }
}