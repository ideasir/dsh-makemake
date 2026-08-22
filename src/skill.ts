/**
 * The compact runtime Skill for the Make Make agent.
 * Keep it minimal — just enough for the model to know the tools exist
 * and when to use which. Implementation details live in tool branches.
 */
export const MAKEMAKE_SKILL = `## Make Make 能力
Make Make 提供图片生成与视频生成两个工具。

### 调用规则
- 用户要画图/出图/生成图片 → 调用 makemake_image(prompt, size?)。
- 需要基于已有图片改造（图生图）→ makemake_image(prompt, image=图片URL)。
- 用户要出视频/让画面动起来（如"让云动起来""水流起来"且带参考图）→ 调用 makemake_video(prompt, duration?)。
- 不确定用户意图时优先询问；不要在用户未要求时擅自生成多媒体内容。
- 工具失败后如实说明原因，不要编造结果。
`
