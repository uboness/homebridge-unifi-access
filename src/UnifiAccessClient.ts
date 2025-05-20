import EventEmitter from 'node:events';
import { createServer, Server } from 'node:http';
import os from 'node:os';
import { Agent, fetch } from 'undici';
import { Detachable, isNil, isString, JSON, ValueCallback } from './common';
import { ILogger } from './Logger';
import { UnifiAccess } from './UnifiAccess';
import DoorUnlocked = UnifiAccess.DoorUnlocked;

// we'll use this agent to connect to unifi access such that we'll ignore their self-signed certs.
const agent = new Agent({
    connect: {
        rejectUnauthorized: false
    }
});

export class UnifiAccessClient {

    private readonly config: UnifiAccessClient.Config;
    private readonly logger: ILogger;

    private readonly emitter = new EventEmitter();
    private server?: Server;
    private webhook?: WebhookData;

    constructor(config: UnifiAccessClient.Config, logger: ILogger) {
        this.config = config;
        this.logger = logger.getLogger('client');
        this.emitter.setMaxListeners(1000);
    }

    get started() {
        return !!this.server && this.server.listening;
    }

    async start() {
        const endpoint = await new Promise<string>((resolve) => {
            this.server = createServer((req, res) => {
                if (req.method === 'POST' && req.headers['content-type'] === 'application/json') {
                    let body = '';

                    // Collect data chunks
                    req.on('data', chunk => {
                        body += chunk.toString();
                    });

                    // End of data
                    req.on('end', () => {
                        try {
                            const message = JSON.parse(body);
                            switch (message.event) {
                                case 'access.door.unlock':
                                    this.emitter.emit('message', {
                                        type: 'door-unlocked',
                                        deviceId: message.data.location.id,
                                        authType: message.data.object.authentication_type,
                                        actor: {
                                            id: message.data.actor.id,
                                            name: message.data.actor.name,
                                            type: message.data.actor.type
                                        }
                                    } as DoorUnlocked);
                            }
                            res.writeHead(200);
                            res.end();
                        } catch (err) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid JSON' }));
                        }
                    });
                } else {
                    res.writeHead(404);
                    res.end();
                }
            }).listen(this.config.webhookPort ?? 0, () => {
                const address = this.server!.address();
                const url = isString(address) ? address : `http://${getLocalIp()}:${address!.port}`;
                this.logger.info(`Started unifi-access webhook server [${url}]`)
                resolve(url);
            });
        });

        this.webhook = await this.registerWebhook(endpoint);
    }

    async close() {
        if (this.webhook) {
            this.logger.debug(`Unregistering webhook [${this.webhook.id}]`);
            await this.rest('delete', `/webhooks/endpoints/${this.webhook.id}`);
        }
        return new Promise<void>((resolve) => {
            this.server?.close((error) => {
                if (error) {
                    this.logger.warn(`Encountered an error while closing webhook server`, error);
                }
                resolve();
            })
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

    async getDoor(id: string): Promise<UnifiAccess.Door> {
        const door = await this.rest<FetchDoorData>('get', `/doors/${id}`);
        return {
            type: 'door',
            id: door.id,
            model: 'door',
            name: door.name,
            locked: door.door_lock_relay_status === 'lock',
            position: isNil(door.door_position_status) || door.door_position_status === 'none' ? undefined : door.door_position_status
        }
    }

    async unlockDoor(id: string): Promise<void> {
        await this.rest<string>('put', `/doors/${id}/unlock`);
    }

    async identifyDevice(type: UnifiAccess.Device['type'], id: string) {
        // this.logger.debug(`Identifying [${type}] device [${id}]`);
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

    private async registerWebhook(endpoint: string): Promise<WebhookData> {
        try {
            const webhook = await this.rest<WebhookData>('post','/webhooks/endpoints', {
                endpoint,
                name: 'homebridge-unifi-access',
                events: [
                    'access.doorbell.incoming',
                    'access.doorbell.completed',
                    'access.doorbell.incoming.REN',
                    'access.device.dps_status',
                    'access.door.unlock',
                    'access.device.emergency_status'
                ]
            });
            this.logger.debug(`Registered webhook [${webhook.id}] for ${endpoint}`);
            return webhook;
        } catch (error: any) {
            if (error.code === 'CODE_DEVICE_WEBHOOK_ENDPOINT_DUPLICATED') {
                const webhooks = await this.rest<WebhookData[]>('get','/webhooks/endpoints');
                const webhook = webhooks.find(webhook => webhook.endpoint === endpoint);
                if (webhook) {
                    this.logger.debug(`Reusing webhook [${webhook.id}] that already existed for [${endpoint}]`);
                    return webhook;
                }
            }
            this.logger.error(`Failed to register webhook for [${endpoint}]`, error);
            throw error;
        }

    }
}

export namespace UnifiAccessClient {

    export type Config = {
        host: string,
        port: number,
        token: string,
        webhookPort?: number
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

type WebhookData = {
    endpoint: string,
    events: string[],
    id: string,
    name: string,
    secret: string,
    headers: Record<string, string>
}

type Resp<T> = {
    code: 'SUCCESS' | string,
    message: 'success' | string,
    data: T
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]!) {
            // Skip over internal (i.e., 127.0.0.1) and non-IPv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }

    return '127.0.0.1'; // fallback
}