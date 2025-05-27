import mqtt from 'mqtt';
import EventEmitter from 'node:events';
import { ILogger } from './Logger';
import { UnifiAccess } from './UnifiAccess';
import { UnifiAccessClient } from './UnifiAccessClient';
import { UnifiAccessPlatform } from './UnifiAccessPlatform';

type EventMap = {
    online: [],
    offline: [],
}

export class Mqtt {

    private readonly platform: UnifiAccessPlatform;
    private readonly unifi: UnifiAccessClient;
    private readonly config: Mqtt.Config;
    private readonly logger: ILogger;

    private readonly emitter = new EventEmitter<EventMap>();

    private _state: Mqtt.State = 'init';
    private _online: boolean = false;

    private client?: mqtt.MqttClient;

    constructor(platform: UnifiAccessPlatform, unifi: UnifiAccessClient, config: Mqtt.Config, logger: ILogger) {
        this.platform = platform;
        this.unifi = unifi;
        this.config = config;
        this.logger = logger.getLogger('mqtt');
    }

    async start() {
        const config = await import(this.platform.api.user.configPath());

        this._state = 'starting';
        this.client = await mqtt.connectAsync({
            clientId: `homebridge-${config.bridge.name}-${this.platform.api.hap.uuid.generate(this.platform.api.user.configPath())}`,
            host: this.config.host,
            port: this.config.port,
            username: this.config.auth?.username,
            password: this.config.auth?.password,
            rejectUnauthorized: true,
            reconnectOnConnackError: true
        });
        this._online = this.client.connected;
        this.client.on('offline', () => {
            this._online = false;
            this.logger.warn('offline');
            this.emitter.emit('offline');
        });
        this.client.on('connect', () => {
            this._online = true;
            this.logger.info('(re)connected');
            this.emitter.emit('online');
        });
        this.client.on('reconnect', () => {
            this.logger.info('attempting to reconnect...');
        });
        this.client.on('message', (fullTopic, msg) => {
            const topic = this.stripTopic(fullTopic);
            if (!topic) {
                return;
            }
            this.logger.debug(`message: topic [${topic}] value [${msg.toString('utf-8')}]`);
        });

        this.unifi.on('message', msg => {
            if (!this.config.events || this.config.events.includes(msg.type)) {
                this.onMessage(msg);
            }
        });

        this._state = 'started';
    }

    async close() {
        this._state = 'closing';
        await this.client?.endAsync();
        this.client = undefined;
        this._state = 'closed';
    }

    get state(): Mqtt.State {
        return this._state;
    }

    get online(): boolean {
        return this._online;
    }

    private onMessage(msg: UnifiAccess.Message) {
        const { type, ...rest } = msg;
        switch (msg.type) {
            case 'door-access':
                this.publish('access-event', JSON.stringify(rest));
                return;
            case 'door-update':
                const state = rest as Omit<UnifiAccess.DoorUpdate, 'type'>
                this.publish(`door/${state.id}`, JSON.stringify(state));
                this.publish(`door/${state.name}`, JSON.stringify(state));
        }
    }

    private publish(topic: string, value: string | number | boolean) {
        topic = topic.startsWith('/') ? topic.substring(1) : topic;
        this.client?.publishAsync(this.fullTopic(topic), `${value}`, {
            qos: 0,
            retain: true
        });
    }

    private stripTopic(fullTopic: string): string | undefined {
        if (!this.config.baseTopic) {
            return fullTopic;
        }
        if (!fullTopic.startsWith(this.config.baseTopic)) {
            return;
        }
        return fullTopic.substring(this.config.baseTopic.length + 1);
    }

    private fullTopic(topic: string): string {
        return this.config.baseTopic ? `${this.config.baseTopic}/${topic}` : topic;
    }
}

export namespace Mqtt {

    export type State = 'init' | 'starting' | 'started' | 'closing' | 'closed';

    export type Config = {
        host: string,
        port?: number,
        baseTopic?: string,
        auth?: {
            username: string,
            password: string,
        },
        events?: Array<UnifiAccess.Message['type']>
    }
}