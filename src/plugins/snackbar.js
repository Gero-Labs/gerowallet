const active = false
const text = ''
const timeout = 5000
const color = 'primary'

export default {
    setError(text) {
        this.text = text
        this.color = '#ff6464'
        this.active = true
    },
    setTimeout(val) {
        this.timeout = val
    },
    active,
    text,
    timeout,
    color
}