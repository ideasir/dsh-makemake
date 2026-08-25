// 命令高亮：渠道名命令（/渠道名）用亮蓝色 #00E5FF，提示词保持原色
  // 只替换 backdrop 里命令部分为 <span>，不碰提示词文本
  // 不用 MutationObserver（避免 React 渲染冲突），只用 setInterval 定时检查
  ctx.effect(() => {
    let lastSnapshot = ''
    const paint = () => {
      const backdrop = document.querySelector('.uV2eYG_backdrop')
      if (!backdrop) return
      const text = backdrop.textContent ?? ''
      // 文本没变 → 跳过
      if (text === lastSnapshot) return
      lastSnapshot = text
      const cmdMatch = text.match(/^(\/\S+\s*)(.*)/)
      if (cmdMatch) {
        // 包裹命令部分为亮蓝色 span，提示词保持原样
        const cmd = cmdMatch[1]
        const rest = cmdMatch[2]
        backdrop.innerHTML = `<span style="color:#00E5FF!important;text-shadow:0 0 10px rgba(0,229,255,0.6)!important">${cmd.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>${rest.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`
      } else {
        if (backdrop.children.length > 0) {
          backdrop.textContent = text
        }
      }
    }
    const iv = setInterval(paint, 300)
    return () => { clearInterval(iv) }
  }, 'dsh-makemake: hl-color')