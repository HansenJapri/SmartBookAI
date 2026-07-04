// Render markdown sederhana menjadi HTML yang aman untuk dokumen legal.
// Didukung: "## Judul", "### Subjudul", "**tebal**", baris "- daftar",
// paragraf biasa, dan tautan [teks](url).
// Keamanan: seluruh teks di-escape LEBIH DULU, baru ditransformasikan,
// sehingga tidak ada celah XSS walau isi diedit dari panel admin.

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ))
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      const u = String(url).trim()
      const safe = /^(https?:|mailto:|\/)/i.test(u) ? u : '#'
      return `<a href="${safe}" target="_blank" rel="noreferrer">${label}</a>`
    })
}

export function renderLegalMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  let html = ''
  let inList = false
  const closeList = () => { if (inList) { html += '</ul>'; inList = false } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    if (line.startsWith('### ')) { closeList(); html += `<h4>${inline(line.slice(4))}</h4>`; continue }
    if (line.startsWith('## ')) { closeList(); html += `<h3>${inline(line.slice(3))}</h3>`; continue }
    if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(line.slice(2))}</li>`
      continue
    }
    closeList()
    html += `<p>${inline(line)}</p>`
  }
  closeList()
  return html
}
