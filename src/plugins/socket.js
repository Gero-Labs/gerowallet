import * as SockJS from 'sockjs-client'
import Stomp from 'stompjs'

const backendBaseUrl = process.env.VUE_APP_BACKEND_URL
const message = ''
const connected = false

export default {
    message,
    connected,
    setMessage(val) {
      this.message = val
    },
    stompConnect(chain, network) {
        this.chain = chain
        this.network = network
        this.stompClient = Stomp.over(new SockJS(`${backendBaseUrl}/sock`))
        // this.stompClient.debug = null
        this.stompClient.reconnect_delay = 3000
        this.stompClient.connect({}, () => {
            this.connected = true
            this.stompSuccessCallback()
        }, e => {
            this.connected = false
            console.log(e)
            setTimeout(() => {
                this.stompConnect(chain, network)
            }, 10000)
        })
    },
    stompSuccessCallback() {
        if (this.subscription) {
            this.subscription.sub.unsubscribe()
        }
        if (this.connected) {
            this.subscription = {
                sub: this.stompClient.subscribe(`/topic/blocktip/${this.chain}/${this.network}`, val => {
                    const data = JSON.parse(val.body)
                    this.setMessage(Object.assign({}, data))
                }),
            }
        }
    },
    isConnected() {
        return this.stompClient?.connected || this.connected
    }
}