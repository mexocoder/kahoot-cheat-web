const EventEmitter = require('events');
const WebSocket = require('ws');

class Kahoot extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
    }

    join(pin, name) {
        return new Promise((resolve, reject) => {
            // Подключение напрямую к WebSocket Kahoot
            this.ws = new WebSocket(`wss://kahoot.it/cometd/${pin}`);
            
            this.ws.on('open', () => {
                this.emit('joined');
                resolve();
            });

            this.ws.on('error', (err) => {
                reject(err);
            });
        });
    }

    leave() {
        if (this.ws) this.ws.close();
    }
}

module.exports = Kahoot;
