/**
 * The compact runtime Skill for the Make Make agent.
 * Keep it minimal — just enough for the model to know the tools exist
 * and when to use which. Implementation details live in tool branches.
 */
export const MAKEMAKESKILL = `## Make Make 工具
Make Make 提供两个工具：**makemake_image**（图片生成）和 **makemake_video**（视频生成）。

### 调用规则（铁律）
- 用户要求出图/出视频时，**直接调用对应工具，不要解释，不要询问**
- prompt 参数必须与用户输入完全一致，禁止改写、润色、扩写、翻译、补充
- 工具自动使用当前选中的渠道（settings 里配置的 selectedImageChannel / selectedVideoChannel）
- 工具失败后如实说明原因，不要编造结果
- 如果用户没有明确要求生成多媒体，不要擅自调用工具
`