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

### makemake_video 视频模式（重要）
- 用户给了一张图并要它动起来 → 把图传给 **image** 参数（图生视频）。
- 用户给了一段视频（「引用此视频」会插入一个短且唯一的注册简码「[视频N]」，如 [视频1]、[视频2]，模型凭它定位视频）并说「继续/延续它」→ **视频生视频/视频延续**：
  1. 先**看明白视频在发生什么**：用 looklook_see 看该视频内容，或用 ffmpeg 抽取几帧关键帧，确认角色/场景/镜头/动作。
  2. 再调用 makemake_video，把该视频的「[视频N]」简码传给 **video** 参数（工具会自动按简码定位视频并抽取它**最后一帧**作为新段起始帧，即关键帧起始动画）。
  3. 提示词**只描述下一小段要发生的动作/变化**，并与上一段保持角色、场景、镜头、风格一致。
- 用户分别给出首帧/尾帧 → 传 **first_frame** / **last_frame**。
- 若用户引用了某个已生成视频并说继续，优先用那个视频的「[视频N]」简码作为 video 参数。
`