/**
 * The compact runtime Skill for the Make Make agent.
 * Keep it minimal — just enough for the model to know the tools exist
 * and when to use which. Implementation details live in tool branches.
 */
export const MAKEMAKE_SKILL = `## Make Make 能力
Make Make 提供图片生成与视频生成两个工具。

### 调用规则
- 用户输入 **/渠道名 prompt**（如 /gpt出图通道 一只猫）→ 通过 channel 参数指定渠道名，调用 makemake_image(prompt, channel=该渠道名)。
- 需要基于已有图片改造（图生图）→ 也走 makemake_image(prompt, image=图片URL)。
- 用户要出视频/让画面动起来（如"让云动起来""水流起来"且带参考图）→ 调用 makemake_video(prompt)。
- 用户只说要"出图/出视频"未指定渠道 → 用当前选中的渠道即可，不需要填 channel。
- 不确定用户意图时优先询问；不要在用户未要求时擅自生成多媒体内容。
- 工具失败后如实说明原因，不要编造结果。

### 提示词透传铁律
- prompt 参数必须**原样透传**用户说的话（保留原文语言和细节），禁止自己改写、扩写、翻译或"优化"。
- 图生图时：用户怎么描述就怎么传，不要自行补充"Same scene""ADDITION"等额外描述。
- 只有用户没给尺寸时，才允许补默认 size；其余参数一律原样。`