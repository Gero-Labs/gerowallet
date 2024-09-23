import SockJS from 'sockjs-client';
import Stomp, { Client, Subscription } from 'stompjs';
import {Wallet} from "@/models/wallet";
import { Blockchain, Network, Provider } from '@/models/types';
import {useStore} from "@/store";
import networks from '@/shared/utils/networks';

export class SocketPlugin {

  public message: string = '';
  public connected: boolean = false;
  public sessionId: string;

  private client: Client;
  private wallet: Wallet = undefined;
  private subscription: {
    sub?: Subscription;
    price: Subscription;
    tip?: Subscription;
    rates?: Subscription;
    sync?: Subscription
  }

  async setMessage(value: string) {
    this.message = value;
    const msg_type = value['message_type']
    const object = value['object']
    if (msg_type === 'TIP') {
      await this.wallet.sync(object)
    } else if (msg_type === 'PRICE') {
      useStore().setPrice(object)
    } else if (msg_type === 'FIAT_RATES') {
      await useStore().setFiatRates(object)
    } else if (msg_type === 'SYNC') {
      await this.wallet.setSync(object)
    }
  }

  generateSessionId() {
    return 'session-' + Math.random().toString(36).substr(2, 9);
  }

  stompConnect(wallet: Wallet) {
    this.wallet = wallet;
    const socket: WebSocket = new SockJS(`${process.env['VUE_APP_BACKEND_URL']}/sock`)
    this.client = Stomp.over(socket);
    this.client.debug = null;
    this.client.connect(
      {},
      () => {
        this.connected = true;
        this.sessionId = this.generateSessionId();
        this.stompSuccessCallback();
      },
      (error: any) => {
        this.connected = false;
        console.log(error);
        setTimeout(() => {
          this.stompConnect(wallet);
        }, 10000);
      }
    );
  }

  stompDisconnect() {
    if (this.client && this.client.connected) {
      this.client.disconnect(() => {
        console.log('Disconnected')
      })
    }
  }

  sendSync(from: number, to: any, address: string, rewards_sum: string, controlled_amount: string, withdrawable_amount: string,) {
    if (this.client && this.client.connected) {
      const body = {
        chain: Object.keys(Blockchain).find(key => Blockchain[key] === this.wallet.chain),
        network: Object.keys(Network).find(key => Network[key] === this.wallet.network),
        provider: Provider[networks.resolveDefaultProvider(this.wallet.chain, this.wallet.network)],
        from_block_height: from,
        to,
        address,
        rewards_sum: (rewards_sum ? rewards_sum : "0"),
        controlled_amount: (controlled_amount ? controlled_amount : "0"),
        withdrawable_amount: (withdrawable_amount ? withdrawable_amount : "0"),
        session_id: this.sessionId
      }
      this.client.send("/app/sync", {}, JSON.stringify(body))
    }
  }

  stompSuccessCallback() {
    if (this.subscription) {
      if (this.subscription.sub) {
        this.subscription.sub.unsubscribe();
      }
      if (this.subscription.price) {
        this.subscription.price.unsubscribe();
      }
    }

    if (this.connected) {
      const chain = Object.keys(Blockchain).find(key => Blockchain[key] === this.wallet.chain);
      const network = Object.keys(Network).find(key => Network[key] === this.wallet.network)
      this.subscription = {
        tip: this.client.subscribe(`/topic/blocktip/${chain}/${network}`, (val: Stomp.Message) => {
          const data = JSON.parse(val.body);
          this.setMessage(Object.assign({}, data));
        }),
        price: this.client.subscribe(`/topic/price/${chain}/${network}`, (val: Stomp.Message) => {
          const data = JSON.parse(val.body);
          this.setMessage(Object.assign({}, data));
        }),
        rates: this.client.subscribe(`/topic/rates`, (val: Stomp.Message) => {
          const data = JSON.parse(val.body);
          this.setMessage(Object.assign({}, data));
        }),
        sync: this.client.subscribe(`/topic/sync/${this.sessionId}` , (val: Stomp.Message) => {
          const data = JSON.parse(val.body);
          this.setMessage(Object.assign({}, data));
        })
      };
    }
  }

  isConnected() {
    return this.client?.connected || this.connected;
  }

}

export default new SocketPlugin();
