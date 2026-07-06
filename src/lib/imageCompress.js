// Kompresi foto struk di SISI KLIEN sebelum dikirim ke AI vision.
// Manfaat: hemat token vision (biaya), hemat kuota data seluler, lebih cepat.
// Bila gagal (format tak didukung browser, mis. HEIC), kembalikan file asli.
export async function compressImage(file, maxDim = 1280, quality = 0.82) {
  try {
    if (!file || !file.type?.startsWith('image/')) return file
    if (file.size < 300 * 1024) return file // sudah kecil — tidak perlu
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bmp, 0, 0, w, h)
    if (typeof bmp.close === 'function') bmp.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    const base = (file.name || 'struk').replace(/\.\w+$/, '')
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
