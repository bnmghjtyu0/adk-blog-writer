import {
  Agent,
  Workflow,
  node,
  createEvent,
  NodeContext,
} from "@google/adk";
import { LiteLlmModel } from "../shared/lite-llm";

const model = new LiteLlmModel({ model: "gemma4:e4b", temperature: 0.1 });

// 1. 定義 Agent（統一使用 {state_key} 語法從狀態注入資料）
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

const blogWriter = new Agent({
  name: "BlogWriter",
  model,
  description: "Writes a technical blog post from the outline.",
  instruction: `You are a professional technical writer.

Here is the approved outline you MUST follow:
<blog_outline>
{blog_outline}
</blog_outline>

Previous validation feedback (if retrying): {validation_result?}

CRITICAL RULE: You MUST strictly write the article based EXCLUSIVELY on the outline provided in <blog_outline> above. 
- Do NOT change the topic. 
- Do NOT invent a new subject.
- Expand the existing outline into a complete Markdown article in Traditional Chinese (繁體中文).
- Audience: software engineers or tech enthusiasts depending on the outline.
- Explain both the 'how' and 'why'.
- Output only the final article in Markdown (no fence around the whole post).`,
  outputKey: "blog_post",
});

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

Check for: intro, clear sections matching the outline, conclusion, and technical clarity.
If passes, respond "ok". Else respond "retry" with the specific fixes.`,
  outputKey: "validation_result",
});

// 2. 路由節點（容錯比對並透過 state 傳遞最終文章）
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
    // 驗證通過時不指定 route，讓 Workflow 自然結束並輸出完整文章
    return ctx.state.get("blog_post") ?? validationResult;
  },
  { name: "RoutePostValidation" },
);

const currentDate = new Date().toISOString().split("T")[0];

// 3. 透過 Workflow 串接圖形結構（僅使用 START，無後續 edge 即自然結束）
export const rootAgent = new Workflow({
  name: "Blogger",
  edges: [
    // 規劃與大綱驗證迴圈
    ["START", blogPlanner, OutlineValidationChecker, RouteOutlineValidation],
    [
      RouteOutlineValidation,
      { BLOG_PLAN: blogPlanner, BLOG_WRITER: blogWriter },
    ],

    // 寫作與文章驗證迴圈
    [blogWriter, BlogPostValidationChecker, RoutePostValidation],
    [
      RoutePostValidation,
      { BLOG_RETRY: blogWriter },
    ],
  ],
  description: `If the user gives a topic:
1) Call the planner tool to generate the outline.
2) Call the writer tool to produce the full draft.
3) End with 3 alternate titles and 2 tweet-length hooks.
If the trends tool fails or times out, continue with a sensible outline and draft anyway.
Date: ${currentDate}`,
});