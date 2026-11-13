import {
  Agent,
  Workflow,
  node,
  createEvent,
  NodeContext,
  FunctionTool,
} from "@google/adk";
import { LiteLlmModel } from "../shared/lite-llm";
import { ComfyUIBackend } from "../shared/comfy-ui";
import * as tools from "./tools";
import { z } from "zod";

const model = new LiteLlmModel({ model: "gemma4:e4b", temperature: 0.1 });

// 整合 ComfyUI 作為圖像生成後端
tools.setBackend(new ComfyUIBackend());

// 宣告生圖工具 1：技術架構圖
const generateTechnicalDiagramTool = new FunctionTool({
  name: "generate_technical_diagram",
  description: "Generate a technical architecture diagram, hardware blueprint, or system flow illustration and save it as an artifact.",
  parameters: z.object({
    prompt: z.string().describe("English visual prompt describing the hardware, architecture, or system flow to draw"),
    style: z.enum(["blueprint", "infographic", "schematic"]).describe("Visual style of the diagram"),
    caption: z.string().describe("Traditional Chinese (繁體中文) caption explaining the diagram for the reader"),
  }),
  execute: async ({ prompt, style, caption }, toolContext) => {
    const result = await tools.generateTechnicalDiagram(prompt, style, caption, toolContext);
    return JSON.stringify(result);
  },
});

// 宣告生圖工具 2：市場與生態系圖表
const generateMarketVisualTool = new FunctionTool({
  name: "generate_market_visual",
  description: "Generate a hero banner, ecosystem loop diagram, or market comparison visual and save it as an artifact.",
  parameters: z.object({
    topic: z.string().describe("English visual prompt describing the market concept, ecosystem loop, or hero illustration"),
    visualType: z.enum(["ecosystem_loop", "comparison_chart", "hero_banner"]).describe("Type of editorial visual"),
    caption: z.string().describe("Traditional Chinese (繁體中文) caption explaining the visual"),
  }),
  execute: async ({ topic, visualType, caption }, toolContext) => {
    const result = await tools.generateMarketVisual(topic, visualType, caption, toolContext);
    return JSON.stringify(result);
  },
});

// 1. 內容策略規劃 Agent
const blogPlanner = new Agent({
  name: "BlogPlanner",
  model,
  description: "Creates a practical, skimmable outline in Markdown.",
  instruction: `You are a technical content strategist. Produce a clear Markdown outline with:
- Title
- Short intro
- 4-6 main sections (each with 2-3 bullets)
- Conclusion

Optional context from codebase (if available): {codebase_context?}
Previous validation feedback (if retrying): {validation_result?}

Return only the outline in Markdown.`,
  outputKey: "blog_outline",
});

// 2. 大綱驗證檢查員
const OutlineValidationChecker = new Agent({
  name: "OutlineValidationChecker",
  model,
  description: "Validates that the outline is usable.",
  instruction: `Check the following outline:
<blog_outline>
{blog_outline}
</blog_outline>

If it has a title, intro, 4-6 sections, and a conclusion, respond exactly "ok". Otherwise respond exactly "retry" and list missing pieces.`,
  outputKey: "validation_result",
});

// 3. 具備生圖能力的技術文章寫作者
const blogWriter = new Agent({
  name: "BlogWriter",
  model,
  description: "Writes a technical blog post from the outline and generates real images via ComfyUI.",
  instruction: `You are a professional technical writer.

Here is the approved outline you MUST follow:
<blog_outline>
{blog_outline}
</blog_outline>

Previous validation feedback (if retrying): {validation_result?}

CRITICAL RULES:
1. Strictly write the article based EXCLUSIVELY on the outline provided in <blog_outline>.
2. Expand the outline into a complete Markdown article in Traditional Chinese (繁體中文).
3. **Generate Real Visuals**: 
   - Call \`generate_market_visual\` (with visualType: "hero_banner") right after the intro to create a cover image.
   - Call \`generate_technical_diagram\` or \`generate_market_visual\` 2-3 times across the main sections whenever explaining complex hardware specs, system architecture, or ecosystem loops.
   - Pass English descriptions to the \`prompt\` / \`topic\` parameter for better ComfyUI rendering, and Traditional Chinese to \`caption\`.
   - Embed the exact \`markdown_embed\` string returned by each tool (e.g., \`![圖說](diagram_0.png)\`) directly into the corresponding section of your Markdown post.
4. Output only the final article in Markdown (no fence around the whole post).`,
  outputKey: "blog_post",
  tools: [generateTechnicalDiagramTool, generateMarketVisualTool],
});

// 4. 文章最終檢核檢查員
const BlogPostValidationChecker = new Agent({
  name: "BlogPostValidationChecker",
  model,
  description: "Validates the final post.",
  instruction: `Check the following blog post against the outline:
<blog_outline>
{blog_outline}
</blog_outline>

<blog_post>
{blog_post}
</blog_post>

Check for:
1. Intro & Conclusion: Clear hook and strong wrap-up.
2. Section Alignment: Clear sections matching the outline.
3. Visual Integration: Ensure at least 2-3 real Markdown image embeds (e.g., \`![caption](diagram_0.png)\` or \`![caption](visual_0.png)\`) are present and placed logically across the article.
4. Technical Clarity: Complex terms are clearly explained.

If passes, respond "ok". Else respond "retry" with the specific fixes.`,
  outputKey: "validation_result",
});

// 路由節點設定
const RouteOutlineValidation = node(
  (_ctx: NodeContext, validationResult: string) =>
    validationResult?.trim().toLowerCase().startsWith("retry")
      ? createEvent({ route: "BLOG_PLAN", output: validationResult })
      : createEvent({ route: "BLOG_WRITER", output: validationResult }),
  { name: "RouteOutlineValidation" },
);

const RoutePostValidation = node(
  (ctx: NodeContext, validationResult: string) => {
    if (validationResult?.trim().toLowerCase().startsWith("retry")) {
      return createEvent({ route: "BLOG_RETRY", output: validationResult });
    }
    return ctx.state.get("blog_post") ?? validationResult;
  },
  { name: "RoutePostValidation" },
);

const currentDate = new Date().toISOString().split("T")[0];

// 5. Workflow 主迴圈圖形結構
export const rootAgent = new Workflow({
  name: "Blogger",
  edges: [
    ["START", blogPlanner, OutlineValidationChecker, RouteOutlineValidation],
    [
      RouteOutlineValidation,
      { BLOG_PLAN: blogPlanner, BLOG_WRITER: blogWriter },
    ],
    [blogWriter, BlogPostValidationChecker, RoutePostValidation],
    [
      RoutePostValidation,
      { BLOG_RETRY: blogWriter },
    ],
  ],
  description: `If the user gives a topic:
1) Call the planner tool to generate the outline.
2) Call the writer tool to produce the full draft with generated ComfyUI diagrams and visuals.
Date: ${currentDate}`,
});