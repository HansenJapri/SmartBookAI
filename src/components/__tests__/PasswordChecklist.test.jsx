// Component test <PasswordChecklist> — memastikan umpan balik kebijakan
// password yang DILIHAT pengguna benar-benar mencerminkan checkPassword().
// Kalau centang muncul padahal aturan belum terpenuhi, pengguna baru berhenti
// memperbaiki password dan pendaftaran gagal di server.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PasswordChecklist from '../PasswordChecklist'
import { PASSWORD_RULES } from '../../lib/validators'

const barisTerpenuhi = () =>
  Array.from(document.querySelectorAll('.pw-check li.ok')).map((li) => li.textContent.trim())

describe('<PasswordChecklist>', () => {
  it('tidak merender apa pun saat password kosong', () => {
    const { container } = render(<PasswordChecklist value="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('menampilkan seluruh aturan kebijakan saat password mulai diketik', () => {
    render(<PasswordChecklist value="a" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(PASSWORD_RULES.length)
    for (const [, label] of PASSWORD_RULES) {
      expect(screen.getByText(label, { exact: false })).toBeInTheDocument()
    }
  })

  it('menandai hanya aturan yang benar-benar terpenuhi', () => {
    render(<PasswordChecklist value="abcdefgh" />) // panjang + huruf kecil saja
    const ok = barisTerpenuhi()
    expect(ok).toHaveLength(2)
    expect(ok.join(' ')).toContain('Minimal 8 karakter')
    expect(ok.join(' ')).toContain('huruf kecil')
  })

  it('menandai seluruh aturan terpenuhi pada password yang sah', () => {
    render(<PasswordChecklist value="Rahasia123!" />)
    expect(barisTerpenuhi()).toHaveLength(PASSWORD_RULES.length)
  })

  it('tidak menandai aturan panjang pada password 7 karakter', () => {
    render(<PasswordChecklist value="Ab1!xyz" />)
    const ok = barisTerpenuhi().join(' ')
    expect(ok).not.toContain('Minimal 8 karakter')
    expect(ok).toContain('simbol')
  })
})
