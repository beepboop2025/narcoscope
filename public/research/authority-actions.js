(() => {
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href.split(/[?#]/)[0]
  const title = document.querySelector('h1')?.textContent?.trim() || document.title
  const status = document.querySelector('.authority-status')
  let timer

  const say = (message) => {
    if (!status) return
    status.textContent = message
    clearTimeout(timer)
    timer = setTimeout(() => { status.textContent = '' }, 2400)
  }
  const tracked = (action) => {
    const url = new URL(canonical)
    url.searchParams.set('utm_source', 'narcoscope')
    url.searchParams.set('utm_medium', 'earned_share')
    url.searchParams.set('utm_campaign', 'research_guides')
    url.searchParams.set('utm_content', action)
    return url.toString()
  }
  const copy = async (value, message) => {
    await navigator.clipboard.writeText(value)
    say(message)
  }
  const downloadCard = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, 1200, 630)
    const gradient = ctx.createLinearGradient(72, 80, 1120, 540)
    gradient.addColorStop(0, '#79e8ee'); gradient.addColorStop(1, '#ffab98')
    ctx.fillStyle = gradient; ctx.fillRect(72, 78, 188, 5)
    ctx.fillStyle = '#79e8ee'; ctx.font = '700 24px system-ui'; ctx.fillText('NARCOSCOPE · RESEARCH GUIDE', 72, 140)
    ctx.fillStyle = '#f4f7f7'; ctx.font = '400 54px Georgia'
    const words = title.split(/\s+/); const lines = []; let line = ''
    words.forEach((word) => { const next = line ? `${line} ${word}` : word; if (ctx.measureText(next).width > 1010 && line) { lines.push(line); line = word } else line = next })
    if (line) lines.push(line)
    lines.slice(0, 3).forEach((text, i) => ctx.fillText(text, 72, 235 + i * 68))
    ctx.fillStyle = '#a5b2b8'; ctx.font = '400 25px system-ui'; ctx.fillText('Official sources · explicit units · visible claim limits', 72, 505)
    ctx.fillStyle = '#79e8ee'; ctx.font = '500 21px ui-monospace'; ctx.fillText(canonical.replace(/^https?:\/\//, ''), 72, 560)
    canvas.toBlob((blob) => {
      if (!blob) return say('Export unavailable')
      const href = URL.createObjectURL(blob); const link = document.createElement('a')
      link.href = href; link.download = `narcoscope-${location.pathname.split('/').filter(Boolean).pop() || 'research'}.png`; link.click()
      setTimeout(() => URL.revokeObjectURL(href), 4000); say('Share card saved')
    }, 'image/png')
  }

  document.querySelectorAll('[data-authority-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.authorityAction
      try {
        if (action === 'share') {
          const url = tracked('native_share')
          if (navigator.share) await navigator.share({ title, text: 'Inspect the official record and its limits.', url })
          else await copy(url, 'Tracked link copied')
        } else if (action === 'citation') {
          await copy(`NarcoScope. “${title}.” NarcoScope, accessed ${new Date().toISOString().slice(0, 10)}. ${canonical}`, 'Citation copied')
        } else if (action === 'link') await copy(tracked('copy_link'), 'Tracked link copied')
        else if (action === 'card') downloadCard()
      } catch (error) { if (error?.name !== 'AbortError') say('Action unavailable') }
    })
  })
})()
