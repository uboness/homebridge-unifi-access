import EventEmitter from 'node:events';
import { Agent, fetch, WebSocket } from 'undici';
import { Detachable, isNil, JSON, ValueCallback } from './common';
import { ILogger } from './Logger';
import { UnifiAccess } from './UnifiAccess';


// we'll use this agent to connect to unifi access such that we'll ignore their self-signed certs.
const agent = new Agent({
    connect: {
        rejectUnauthorized: false
    }
});

type EventMap = {
    connect: [],
    disconnect: [],
    close: [],
    message: [ UnifiAccess.Message ]
}

export class UnifiAccessClient {

    private readonly config: UnifiAccessClient.Config;
    private readonly logger: ILogger;

    private readonly emitter = new EventEmitter<EventMap>();
    private socket?: WebSocket;

    private _state: 'init' | 'starting' | 'connected' | 'disconnected' | 'closing' | 'closed' = 'init';

    constructor(config: UnifiAccessClient.Config, logger: ILogger) {
        this.config = config;
        this.logger = logger.getLogger('client');
        this.emitter.setMaxListeners(1000);
        this.emitter.on('connect', () => {
            this.logger.info('connected');
        });
    }

    get connected() {
        return this._state === 'connected';
    }

    async start() {
        this._state = 'starting';
        await this.connect(0, 5);
    }

    async close() {
        this._state = 'closing';
        this.socket?.close();
        this._state = 'closed';
        this.emitter.emit('close');
    }

    private readonly timeouts = [1, 1, 2, 3, 5, 8, 13, 21, 34]
    private timeout(attempt: number): number {
        return this.timeouts.length > (attempt) ? this.timeouts[attempt] : this.timeouts[this.timeouts.length - 1];
    }
    private async connect(attempt: number, maxAttempts: number): Promise<void> {
        if (attempt + 1 === maxAttempts) {
            return Promise.reject('Failed to connect');
        }
        return new Promise<void>((resolve, reject) => {
            const url = this.wsUrl();
            if (attempt > 0) {
                this.logger.warn(`reconnecting to [${url}] (attempt: ${attempt + 1})...`);
            } else {
                this.logger.debug(`connecting to [${url}]`);
            }

            this.socket = new WebSocket(url, {
                dispatcher: agent,
                headers: {
                    Authorization: `Bearer ${this.config.token}`
                }
            });

            this.socket.addEventListener('message', msg => {
                const { event, data } = JSON.parse(msg.data);
                switch (event) {
                    case 'access.data.v2.location.update':
                        if (data.location_type === 'door') {
                            this.logger.debug(`door update message [${JSON.stringify(data)}]`);
                            this.emitter.emit('message', {
                                type: 'door-update',
                                id: data.id,
                                name: data.name,
                                locked: data.state?.lock !== undefined ? data.state.lock === 'locked' : undefined,
                                available: (data.state?.is_unavailable === undefined ? true : !data.state.is_unavailable) && (data.state?.enable ?? true)
                            });
                        }
                        return;

                    case 'access.logs.add':
                        const door = data._source?.target?.find(location => location.type === 'door');
                        if (door) {
                            this.logger.debug(`door access message [${JSON.stringify(data)}]`);
                            this.emitter.emit('message', {
                                type: 'door-access',
                                door: {
                                    id: door.id,
                                    name: door.display_name
                                },
                                actor: {
                                    id: data._source.actor.id,
                                    type: data._source.actor.type,
                                    name: data._source.actor.display_name,
                                    auth: data._source.authentication.credential_provider
                                }
                            })
                        }
                }
            });

            this.socket.addEventListener('error', (event: any) => {
                this.logger.error(`Webhook socket init error`, event);
                this.socket?.close();
            });

            this.socket.addEventListener('open', () => {
                this.logger.info(`connected`);
                this._state = 'connected';
                this.emitter.emit('connect');
                resolve();
            });

            this.socket.addEventListener('close', () => {
                this.logger.warn(`disconnected`);
                this.emitter.emit('disconnect');
                this.socket = undefined;
                if (this._state !== 'closing') {
                    const newAttempt = this._state == 'connected' ? 0 : attempt + 1;
                    const newMaxAttempts = this._state === 'starting' ? maxAttempts : Infinity;
                    this._state = 'disconnected';
                    if (newAttempt + 1 === newMaxAttempts) {
                        reject('Failed to connect');
                        return;
                    }
                    const timeout = this.timeout(newAttempt);
                    this.logger.info(`Reconnecting in ${timeout} seconds...`);
                    setTimeout(() => {
                        this.connect(newAttempt, newMaxAttempts);
                    }, timeout * 1000);
                }
            });

        });
    }

    on(event: 'message', handler: ValueCallback<UnifiAccess.Message>): Detachable {
        this.emitter.on(event, handler);
        return { detach: () => this.emitter.off(event, handler) };
    }

    async listDevices(): Promise<UnifiAccess.Device[]> {
        return await this.listDoors();
    }

    async listDoors(): Promise<UnifiAccess.Door[]> {
        const resp = await this.rest<FetchDoorData[]>('get', '/doors');
        return resp.map(door => ({
            type: 'door',
            id: door.id,
            model: 'door',
            name: door.name,
            locked: door.door_lock_relay_status === 'lock',
            position: isNil(door.door_position_status) || door.door_position_status === 'none' ? undefined : door.door_position_status
        }));
    }

    async unlockDoor(id: string): Promise<void> {
        await this.rest<string>('put', `/doors/${id}/unlock`);
    }

    async identifyDevice(type: UnifiAccess.Device['type'], id: string) {
        this.logger.warn(`At the moment, Unifi Access API doesn't expose the identify functionality`);
    }

    private async rest<Data = void>(method: 'get' | 'put' | 'post' | 'delete', endpoint: string, reqBody?: JSON): Promise<Data> {
        const url = this.restUrl(endpoint)
        const resp = await fetch(url, {
            dispatcher: agent,
            method,
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: reqBody ? JSON.stringify(reqBody) : undefined
        });
        if (!resp.ok) {
            throw new Error(`Failed to fetch [${endpoint}]. ${resp.status}: ${resp.statusText}`)
        }
        const respBody = (await resp.json()) as Resp<Data>;
        if (respBody.code !== 'SUCCESS') {
            throw new UnifiError(`Failed to fetch [${endpoint}]. ${respBody.message} [code: ${respBody.code}]`, respBody.code);
        }
        return respBody.data;
    }

    private restUrl(endpoint: string): string {
        return `https://${this.config.host}:${this.config.port}/api/v1/developer${endpoint}`;
    }

    private wsUrl(): string {
        return `wss://${this.config.host}:${this.config.port}/api/v1/developer/devices/notifications`;
    }
}

export namespace UnifiAccessClient {

    export type Config = {
        host: string,
        port: number,
        token: string
    }

}

class UnifiError extends Error {
    readonly code: string;
    readonly cause?: Error;
    constructor(message: string, code: string, cause?: Error) {
        super(message);
        this.code = code;
        this.cause = cause;
    }
}

type FetchDoorData = {
    type: 'door',
    id: string,
    full_name: string,
    name: string,
    floor_id: string,
    is_bind_hub: boolean,
    door_lock_relay_status: 'lock' | 'unlock',
    door_position_status: 'open' | 'close' | 'none'
};

type Resp<T> = {
    code: 'SUCCESS' | string,
    message: 'success' | string,
    data: T
}