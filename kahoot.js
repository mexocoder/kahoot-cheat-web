const EventEmitter = require('events');
const WebSocket = require('ws');

class Kahoot extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.clientId = null;
        this.ackCount = 0;
        this.pin = null;
        this.name = null;
    }

    async join(pin, name) {
        this.pin = pin;
        this.name = name;

        try {
            const res = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`);
            if (!res.ok) throw new Error('Неверный PIN или игра недоступна');
            
            const sessionToken = res.headers.get('x-kahoot-session-token');
            const data = await res.json();

            const mask = this.solveChallenge(data.challenge);
            const token = this.decodeToken(sessionToken, mask);

            this.connectWebSocket(token);
        } catch (err) {
            throw { description: err.message || 'Ошибка подключения' };
        }
    }

    solveChallenge(challenge) {
        if (!challenge) return '';
        const clean = challenge.replace(/(\t|\r|\n)/g, '');
        const match = clean.match(/decode\.call\(this,\s*'([^']+)'\)/);
        if (!match) return '';
        const offset = eval(clean.split('var offset =')[1].split(';')[0]);
        const chars = match[1];
        let decoded = '';
        for (let i = 0; i < chars.length; i++) {
            decoded += String.fromCharCode((chars.charCodeAt(i) * i + offset) % 77 + 33);
        }
        return decoded;
    }

    decodeToken(sessionToken, mask) {
        const decoded = Buffer.from(sessionToken, 'base64').toString('ascii');
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
            result += String.fromCharCode(decoded.charCodeAt(i) ^ mask.charCodeAt(i % mask.length));
        }
        return result;
    }

    connectWebSocket(token) {
        this.ws = new WebSocket(`wss://kahoot.it/cometd/${this.pin}/${token}`);

        this.ws.on('open', () => {
            this.send([{
                channel: '/meta/handshake',
                version: '1.0',
                minimumVersion: '1.0',
                supportedConnectionTypes: ['websocket'],
                advice: { timeout: 60000, interval: 0 },
                id: ++this.ackCount
            }]);
        });

        this.ws.on('message', (data) => {
            const packets = JSON.parse(data.toString());
            for (const packet of packets) {
                this.handlePacket(packet);
            }
        });

        this.ws.on('error', (err) => this.emit('error', err));
    }

    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(packet));
        }
    }

    handlePacket(packet) {
        if (packet.channel === '/meta/handshake' && packet.successful) {
            this.clientId = packet.clientId;
            this.send([{
                channel: '/meta/connect',
                clientId: this.clientId,
                connectionType: 'websocket',
                id: ++this.ackCount
            }]);

            this.send([{
                channel: '/service/controller',
                clientId: this.clientId,
                data: {
                    type: 'login',
                    gameid: this.pin,
                    host: 'kahoot.it',
                    name: this.name
                },
                id: ++this.ackCount
            }]);
        } else if (packet.channel === '/service/controller' && packet.data?.type === 'loginResponse') {
            if (packet.data.error) {
                this.emit('error', packet.data.description);
            } else {
                this.emit('joined');
            }
        }
    }

    leave() {
        if (this.ws) this.ws.close();
    }
}

module.exports = Kahoot;
