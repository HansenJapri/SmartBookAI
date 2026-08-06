// Component test <OtpInput> — kontrak: hanya angka yang lolos, dipotong pada
// maxLength, dan input punya nama aksesibel + atribut yang membuat autofill OTP
// bekerja di ponsel.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OtpInput from '../OtpInput'

describe('<OtpInput>', () => {
  it('punya nama aksesibel dan atribut untuk autofill kode OTP', () => {
    render(<OtpInput value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Kode verifikasi')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
  })

  it('membuang karakter non-angka sebelum diteruskan ke onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OtpInput value="" onChange={onChange} />)
    await user.type(screen.getByLabelText('Kode verifikasi'), 'a1b2')
    // Setiap ketikan memicu onChange; huruf menghasilkan string kosong.
    expect(onChange).toHaveBeenLastCalledWith('2')
    expect(onChange.mock.calls.every(([v]) => /^\d*$/.test(v))).toBe(true)
  })

  it('memotong masukan pada maxLength', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // value dikendalikan induk; di sini diuji langsung lewat paste.
    render(<OtpInput value="" onChange={onChange} maxLength={6} />)
    await user.click(screen.getByLabelText('Kode verifikasi'))
    await user.paste('1234567890')
    expect(onChange).toHaveBeenLastCalledWith('123456')
  })

  it('menghormati maxLength kustom (kode 8 digit)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OtpInput value="" onChange={onChange} maxLength={8} />)
    await user.click(screen.getByLabelText('Kode verifikasi'))
    await user.paste('1234567890')
    expect(onChange).toHaveBeenLastCalledWith('12345678')
  })

  it('menampilkan nilai yang dikendalikan induk', () => {
    render(<OtpInput value="482913" onChange={() => {}} />)
    expect(screen.getByLabelText('Kode verifikasi')).toHaveValue('482913')
  })
})
