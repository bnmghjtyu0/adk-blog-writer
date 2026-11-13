/**
 * 影像生成後端的返回結果結構
 */
export interface ImageBackendResult {
  png: Buffer;
  identity_hue: string;
}

/**
 * 影像生成後端（如 ComfyUI 或 Mock 測試）的抽象介面
 */
export interface ImageBackend {
  render(params: {
    sheet: string;
    form: string;
    reference_seed: string;
    reference_png?: Buffer | null;
    instruction?: string | null;
  }): Promise<ImageBackendResult>;
}

/**
 * Google ADK ToolContext 的介面定義（支援狀態讀寫與 Artifact 存取）
 */
export interface ToolContext {
  state: Record<string, any>;
  saveArtifact(
    name: string,
    part: {
      inlineData: {
        mimeType: string;
        data: string; // Base64 編碼的二進位資料
      };
    }
  ): Promise<void>;
  loadArtifact(name: string): Promise<{
    inlineData?: {
      data?: string;
    };
  } | null>;
}

/**
 * 工具執行後的標準返回結果結構
 */
export interface ToolResult {
  status: 'ok' | 'error';
  message?: string;
  artifact?: string;
  caption?: string;
  markdown_embed?: string;
  identity_hue?: string;
  candidates?: string[];
  count?: number;
  outputArtifacts?: Array<{
    name: string;
    mimeType: string;
  }>;
  [key: string]: any; // 允許擴充其他自訂屬性
}