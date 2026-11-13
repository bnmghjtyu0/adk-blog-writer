import { Agent, LlmAgent, LoopAgent, SequentialAgent, Workflow } from "@google/adk";
import { LiteLlmModel } from "../shared/lite-llm";

const model = new LiteLlmModel({ model: "gemma4:e4b", temperature: 0.1 });

const blogWriter = new Agent({
  name: "BlogWriter",
  model,
  description: "Writes a technical blog post from the outline.",
  instruction: `Write a complete Markdown article from the outline in 'blog_outline'.
Guidelines:
- Audience: software engineers; skip basics and focus on practical insight.
- Explain both the 'how' and 'why'.
- Include concise code snippets when helpful.
- Follow the outline's structure (H2/H3).
- Output only the final article in Markdown (no fence around the whole post).`,
  outputKey: "blog_post",
});

const BlogPostValidationChecker = new Agent({
  name: "BlogPostValidationChecker",
  model,
  description: "Validates the final post.",
  instruction: `Check 'blog_post' for: intro, clear sections matching the outline, conclusion, and technical clarity.
If passes, respond "ok". Else respond "retry" with the specific fixes.`,
  outputKey: "validation_result",
});

const OutlineValidationChecker = new Agent({
  name: "OutlineValidationChecker",
  model,
  instruction: `Check the outline in state 'blog_outline'. If it has a title, intro, 4-6 sections, and a conclusion, respond exactly "ok". Otherwise respond exactly "retry" and list missing pieces.`,
  description: "Validates that the outline is usable.",
  outputKey: "validation_result",
});

const blogPlanner = new Agent({
  name: "BlogPlanner",
  model,
  description: "Creates a practical, skimmable outline in Markdown.",
  instruction: `You are a technical content strategist. Produce a clear Markdown outline with:
- Title
- Short intro
- 4-6 main sections (each with 2-3 bullets)
- Conclusion
If 'codebase_context' exists in state, weave in specific sections/snippets.
Return only the outline in Markdown.`,
  outputKey: "blog_outline",
});

const robust_blog_writer = new LoopAgent({
  name: "RobustBlogWriter",
  description: "Retries writing if validation fails.",
  subAgents: [blogWriter, BlogPostValidationChecker],
  maxIterations: 3,
});

const robustBlogPlanner = new LoopAgent({
  name: "RobustBlogPlanner",
  description: "Retries planning if validation fails.",
  subAgents: [blogPlanner, OutlineValidationChecker],
  maxIterations: 3,
});

const currentDate = new Date().toISOString().split("T")[0];



//prompt: generate a blog on the top ten use cases for Al agents

export const rootAgent = new SequentialAgent({
    name: "Blogger",
    subAgents: [
        robustBlogPlanner, // Run first to create initial doc
        robust_blog_writer       // Then run the critique/refine loop
    ],
    description: `If the user gives a topic:
1) Call the planner tool to generate the outline.
2) Call the writer tool to produce the full draft.
3) End with 3 alternate titles and 2 tweet-length hooks.
If the trends tool fails or times out, continue with a sensible outline and draft anyway.
Date: ${currentDate}`
});