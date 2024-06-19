import SockJS from 'sockjs-client';
import Stomp, { Client, Subscription } from 'stompjs';
import {Wallet} from "@/models/wallet";
import {Blockchain, Network} from "@/models/types";
import {useStore} from "@/store";

export class SocketPlugin {

  public message: string = '';
  public connected: boolean = false;

  private client: Client;
  private wallet: Wallet = undefined;
  private subscription: {
    sub?: Subscription;
    price: Subscription;
    tip?: Subscription;
    rates?: Subscription;
  }

  setMessage(value: string) {
    this.message = value;
    if (value['message_type'] === 'TIP') {
      this.wallet.sync(value['object'])
    }
    if (value['message_type'] === 'PRICE') {
      useStore().setPrice(value['object'])
    }
    if (value['message_type'] === 'FIAT_RATES') {
      useStore().setFiatRates(value['object'])
    }
  }

  stompConnect(wallet: Wallet) {
    this.wallet = wallet;

    this.client = Stomp.over(new SockJS(`${process.env['VUE_APP_BACKEND_URL']}/sock`));
    this.client.debug = null;
    this.client.connect(
      {},
      () => {
        this.connected = true;
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
      };
    }
  }

  isConnected() {
    return this.client?.connected || this.connected;
  }

}

export default new SocketPlugin();
