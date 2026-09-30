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

        // 1. Получаем токен сессии от Kahoot API
        try {
            const response = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`);
            if (!response.ok) {
                throw new Error('Неверный PIN или викторина недоступна');
            }
            
            const sessionToken = response.headers.get('x-kahoot-session-token');
            const data = await response.json();

            // 2. Декодируем вебсокет-токен
            const challenge = data.challenge;
            const mask = this.solveChallenge(challenge);
            const webSocketToken = this.decodeToken(sessionToken, mask);

            // 3. Подключаемся через WebSocket
            this.connectWebSocket(webSocketToken);
        } catch (err) {
            throw { description: err.message || 'Ошибка подключения к Kahoot' };
        }
    }

    solveChallenge(challenge) {
        // Простая расшифровка математического челледжа Kahoot
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
        const decodedToken = Buffer.from(sessionToken, 'base64').toString('ascii');
        let result = '';
        for (let i = 0; i < decodedToken.length; i++) {
            result += String.fromCharCode(decodedToken.charCodeAt(i) ^ mask.charCodeAt(i % mask.length));
        }
        return result;
    }

    connectWebSocket(token) {
        const wsUrl = `wss://kahoot.it/cometd/${this.pin}/${token}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            // Handshake пакета CometD
            this.sendPacket([{
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

        this.ws.on('error', (err) => {
            this.emit('error', err);
        });
    }

    sendPacket(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(packet));
        }
    }

    handlePacket(packet) {
        if (packet.channel === '/meta/handshake' && packet.successful) {
            this.clientId = packet.clientId;
            // Регистрация соединения
            this.sendPacket([{
                channel: '/meta/connect',
                clientId: this.clientId,
                connectionType: 'websocket',
                id: ++this.ackCount
            }]);

            // Логин бота в лобби
            this.sendPacket([{
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
        } else if (packet.channel === '/service/controller' && packet.data && packet.data.type === 'loginResponse') {
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
