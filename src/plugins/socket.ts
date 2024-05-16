import SockJS from 'sockjs-client';
import Stomp, { Client, Subscription } from 'stompjs';

export class SocketPlugin {

  public message: string = '';
  public connected: boolean = false;

  private client: Client;
  private chain: string = '';
  private network: string = '';
  private subscription: { sub?: Subscription; price: Subscription; tip?: Subscription; }

  setMessage(value: string) {
    this.message = value;
  }

  stompConnect(chain: string, network: string) {
    this.chain = chain;
    this.network = network;

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
          this.stompConnect(chain, network);
        }, 10000);
      }
    );
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
      this.subscription = {
        tip: this.client.subscribe(`/topic/blocktip/${this.chain}/${this.network}`, val => {
          const data = JSON.parse(val.body);
          this.setMessage(Object.assign({}, data));
        }),
        price: this.client.subscribe(`/topic/price/${this.chain}/${this.network}`, val => {
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
