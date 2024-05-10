import * as SockJS from 'sockjs-client'
import Stomp from 'stompjs'

const backendBaseUrl = process.env.VUE_APP_BACKEND_URL

export default {
    setAddress(address) {
      this.address = address
    },
    stompConnect(chain, network) {
        this.chain = chain
        this.network = network
        this.stompClient = Stomp.over(new SockJS(`${backendBaseUrl}/sock`))
        // this.stompClient.debug = null
        this.stompClient.reconnect_delay = 3000
        this.stompClient.connect({}, () => {
            this.stompSuccessCallback()
        }, e => {
            console.log(e)
            setTimeout(() => {
                this.stompConnect(chain, network)
            }, 5000)
        })
    },
    stompSuccessCallback() {
        if (this.subscription) {
            this.subscription.sub.unsubscribe()
            this.subscription.addressSub.unsubscribe()
        }
        this.subscription = {
            sub: this.stompClient.subscribe(`/api/${this.chain}/${this.network}`, this.msgHandler),
            addressSub: this.stompClient.subscribe(`/api/${this.chain}/${this.network}/address/${this.address}`),
            accountAddress: this.address,
        }
    },
    msgHandler(val) {
        console.log(val)
        const data = JSON.parse(val.body)
        let message = Object.assign({}, data)
        console.log(message)
    },
}