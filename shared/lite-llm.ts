import { BaseLlm, BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk';
import path from 'path';
import fs from 'fs'
export class LiteLlmModel extends BaseLlm {
  public baseUrl: string;
  public maxTokens: number;
  public contextWindow: number;
  public temperature: number;

  constructor(options: {
    model: string;
    baseUrl?: string;
    maxTokens?: number;
    contextWindow?: number;
    temperature?: number;
  }) {
    super({ model: options.model });
    this.baseUrl = options.baseUrl || 'http://localhost:11434/v1';
    this.maxTokens = options.maxTokens || 8192;
    this.contextWindow = options.contextWindow || 16384;
    this.temperature = options.temperature ?? 0.1;
  }

  async connect(llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    return {
      async send(request: LlmRequest): Promise<void> {},
      async close(): Promise<void> {},
      on(event: string, listener: (...args: any[]) => void) {
        return this;
      },
    } as unknown as BaseLlmConnection;
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    stream?: boolean,
    abortSignal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void, any> {
    const messages: any[] = [];

    // 1. System Instruction 轉化
    if (llmRequest.config?.systemInstruction) {
      const sysText =
        typeof llmRequest.config.systemInstruction === 'string'
          ? llmRequest.config.systemInstruction
          : (llmRequest.config.systemInstruction as any).parts?.[0]?.text;

      if (sysText) {
        messages.push({
          role: 'system',
          content: sysText,
        });
      }
    }

    // 2. 完整轉化 ADK 對話歷史 (支援 Text, Inline Vision, FunctionCall 與 Tool Result 中的圖片)
    (llmRequest.contents || []).forEach((content: any) => {
      const role = content.role === 'model' ? 'assistant' : content.role;

      const isToolCall = (content.parts || []).some((p: any) => p.functionCall);
      const isToolResponse = (content.parts || []).some((p: any) => p.functionResponse);

      if (isToolCall) {
        // 處理 Model 發起工具呼叫歷史
        (content.parts || []).forEach((part: any) => {
          if (part.functionCall) {
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call_${part.functionCall.name}_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                },
              ],
            });
          }
        });
      } else if (isToolResponse) {
        // 處理工具執行後回傳結果歷史
        (content.parts || []).forEach((part: any) => {
          if (part.functionResponse) {
            const rawResponse = part.functionResponse.response;
            const toolName = part.functionResponse.name;
            const toolCallId = `call_${toolName}_${Date.now()}`;

            // 🌟 關鍵攔截：如果是我們寫的讀圖工具，且成功回傳了 Base64
            if (toolName === 'load_local_image' && rawResponse?.status === 'success' && rawResponse?.imageBase64) {
              // 1. 先告訴模型工具執行成功
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: `Image ${rawResponse.filePath} loaded successfully.`,
              });

              // 2. 緊接著注入一則 role: 'user' 的多模態圖片訊息（Ollama 唯一認得的讀圖格式）
              messages.push({
                role: 'user',
                content: [
                  { type: 'text', text: `請分析這張剛剛透過工具讀取的 Hit Fm 排行榜圖片 (${rawResponse.filePath})：` },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${rawResponse.mimeType};base64,${rawResponse.imageBase64}`,
                    },
                  },
                ],
              });
            } else {
              // 其他一般工具的正常處理
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content:
                  typeof rawResponse === 'string'
                    ? rawResponse
                    : JSON.stringify(rawResponse),
              });
            }
          }
        });
      } else {
        // 處理 一般對話與視覺圖片 (Text & Vision)
      const contentArray: any[] = [];
        let hasImage = false;

        for (const part of (content.parts || [])) {
          if (part.text !== undefined) {
            let textContent = part.text;
            contentArray.push({ type: 'text', text: textContent });

            // 🌟 自動偵測文字中是否有包含圖片檔案路徑 (例如 pictures/xxx.png)
            const match = textContent.match(/([^\s]+\.(png|jpg|jpeg|webp))/i);
            if (match) {
              const filePath = match[1];
              // 檢查檔案是否存在
              const resolvedPath = path.resolve(process.cwd(), filePath);
              if (fs.existsSync(resolvedPath)) {
                try {
                  const fileBuffer = fs.readFileSync(resolvedPath);
                  const base64Data = fileBuffer.toString('base64');
                  const ext = path.extname(filePath).toLowerCase();
                  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

                  hasImage = true;
                  contentArray.push({
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${base64Data}`,
                    },
                  });
                  console.log(`✅ 成功自動載入本地圖片: ${filePath}`);
                } catch (e) {
                  console.error(`❌ 自動載入圖片失敗: ${filePath}`, e);
                }
              }
            }
          } else if (part.inlineData) {
            hasImage = true;
            const mimeType = part.inlineData.mimeType || 'image/jpeg';
            const base64Data = part.inlineData.data;
            contentArray.push({
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            });
          }
        }

        if (contentArray.length > 0) {
          messages.push({
            role: role,
            content: hasImage ? contentArray : contentArray.map((c) => c.text).join('\n'),
          });
        }
      }
    });

    // 3. 轉譯 Tools Schema
    let tools: any[] | undefined = undefined;
    if (llmRequest.config?.tools && llmRequest.config.tools.length > 0) {
      tools = llmRequest.config.tools
        .map((tool: any) => {
          const declarations = tool.functionDeclarations || [tool];
          return declarations.map((decl: any) => ({
            type: 'function',
            function: {
              name: decl.name,
              description: decl.description || '',
              parameters: decl.parameters || { type: 'object', properties: {} },
            },
          }));
        })
        .flat();
    }

    // 4. 發送請求至 Ollama / LiteLLM API
    const requestBody: Record<string, any> = {
      model: this.model,
      messages: messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      options: {
        num_predict: this.maxTokens,
        num_ctx: this.contextWindow,
        temperature: this.temperature,
      },
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ollama',
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;

    // 5. 處理 Tool Calls (確保抓取正確參數)
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const functionCalls = message.tool_calls.map((tc: any) => {
        let args = {};
        try {
          args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments || {};
        } catch (e) {
          console.error('❌ Failed to parse tool arguments:', tc.function.arguments);
        }

        return {
          name: tc.function.name,
          args: args,
        };
      });

      yield {
        content: {
          role: 'model',
          parts: functionCalls.map((fc: any) => ({ functionCall: fc })),
        },
      } as unknown as LlmResponse;

      return;
    }

    // 6. 一般文字回應處理
    const responseText = message?.content || '';

    yield {
      content: {
        role: 'model',
        parts: [{ text: responseText }],
      },
    } as unknown as LlmResponse;
  }
}