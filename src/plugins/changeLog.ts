import { reactive } from 'vue';

export class ChangeLog {

  enabled: boolean = false;

  setEnabled(value: boolean) {
    this.enabled = value;
  }
}

// Both the navigation action and the layout must observe the same proxy.
export default reactive(new ChangeLog());
