// Shim for events to provide correct exports for browser environment
// This normalizes the events exports for @ledgerhq/hw-transport

// Create a minimal EventEmitter implementation that works in all environments
class BrowserEventEmitter {
  constructor() {
    this.events = {};
    this.maxListeners = 10;
  }
  
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
    return this;
  }
  
  addListener(event, listener) {
    return this.on(event, listener);
  }
  
  once(event, listener) {
    const onceWrapper = (...args) => {
      this.removeListener(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }
  
  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
      return true;
    }
    return false;
  }
  
  removeListener(event, listener) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
    return this;
  }
  
  removeAllListeners(event) {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
    return this;
  }
  
  listenerCount(event) {
    return this.events[event] ? this.events[event].length : 0;
  }
  
  setMaxListeners(n) {
    this.maxListeners = n;
    return this;
  }
}

// Use our implementation as the EventEmitter
const EventEmitter = BrowserEventEmitter;

// Named export
export { EventEmitter };

// Default export for ES6 compatibility - this is what @ledgerhq/hw-transport expects
export default EventEmitter;