import {
    API,
    Characteristic,
    DynamicPlatformPlugin,
    Logger,
    PlatformAccessory,
    PlatformConfig,
    Service
} from 'homebridge';
import { isUndefined } from './common.js';

import { Device, Devices } from './device';
import { ContextLogger, ILogger } from './Logger.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { UnifiAccess } from './UnifiAccess';
import { UnifiAccessClient } from './UnifiAccessClient';
import { Mqtt } from './mqtt';

/**
 * Homebridge Platform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class UnifiAccessPlatform implements DynamicPlatformPlugin {

    public readonly Service: typeof Service;
    public readonly Characteristic: typeof Characteristic;

    public readonly api: API;
    public readonly logger: ILogger;
    private readonly config: UnifiAccessPlatform.Config;
    private readonly accessories: PlatformAccessory[] = [];

    private readonly client: UnifiAccessClient;
    private readonly mqtt?: Mqtt;

    private readonly devices: Device[] = [];

    constructor(log: Logger, config: PlatformConfig, api: API) {
        this.logger = new ContextLogger(log);
        this.config = config as UnifiAccessPlatform.Config;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.client = new UnifiAccessClient(this.config, this.logger);

        this.api.on('didFinishLaunching', () => this.init());
        this.api.on('shutdown', () => this.dispose());
        if (this.config.mqtt) {
            this.mqtt = new Mqtt(this, this.client, this.config.mqtt, this.logger);
        }
    }

    configureAccessory(accessory: PlatformAccessory) {
        this.accessories.push(accessory);
    }

    async init() {
        await this.client.start();
        await this.mqtt?.start();

        const devices = await this.client.listDevices();
        const deviceById = devices.reduce((deviceById, device) => {
            deviceById[device.id] = device;
            return deviceById;
        }, {} as Record<string, UnifiAccess.Device>);

        // first, let's clean up the cached accessories that are no long available
        const removeAccessories: Array<{ accessory: PlatformAccessory, reason: string }> = [];
        for (let i = 0; i < this.accessories.length; i++) {
            const accessory = this.accessories[i];
            const device = deviceById[accessory.context.deviceId];
            if (!device) {
                this.accessories.splice(i--, 1);
                removeAccessories.push({ accessory, reason: `Device [${accessory.context.deviceType}] no longer available` });
            } else {
                const asGarageDoor = !!this.config.devices?.find(d => d.id == device.id)?.asGarageDoor;
                const deviceType = accessory.context.deviceType;
                if (device.type !== deviceType || asGarageDoor !== accessory.context.asGarageDoor) {
                    this.accessories.splice(i--, 1);
                    removeAccessories.push({ accessory, reason: `Device [${accessory.context.deviceType}] has changed` });
                }
            }
        }

        for (const { reason, accessory } of removeAccessories) {
            this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME,[ accessory ]);
            this.logger.info(`Unregistering cached [${accessory.context.deviceType}] accessory [${accessory.displayName}] (reason: ${reason})`);
        }

        devices.forEach(device => this.registerDevice(device));
    }

    async dispose() {
        await Promise.all(this.devices.map(device => device.close()));
        await this.client.close();
        await this.mqtt?.close();
    }

    async registerDevice(device: UnifiAccess.Device) {
        if (isUndefined(Devices[device.type])) {
            return
        }

        const asGarageDoor = !!this.config.devices?.find(d => d.id == device.id)?.asGarageDoor;

        // generate a unique id for the accessory this should be generated from
        // something globally unique, but constant, for example, the device serial
        // number or MAC address
        const uuid = this.api.hap.uuid.generate(`${device.type}:${device.model}:${device.id}:${asGarageDoor ? 'garage' : 'default'}`);

        // see if an accessory with the same uuid has already been registered and restored from
        // the cached devices we stored in the `configureAccessory` method above
        let accessory = this.accessories.find(accessory => accessory.UUID === uuid);

        if (!accessory) {
            const deviceName = device.name || device.model || device.type;
            accessory = new this.api.platformAccessory(deviceName, uuid);
            accessory.context.deviceId = device.id;
            accessory.context.deviceType = device.type;
            accessory.context.asGarageDoor = asGarageDoor;
            accessory.context.deviceName = deviceName;
            this.logger.info(`Registering [${device.type}] device [${accessory.displayName}] ID [${device.id}]`);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [ accessory ]);
            this.accessories.push(accessory);
        } else {
            this.logger.info(`Found existing [${device.type}] device [${accessory.displayName}] ID [${device.id}]`);
        }

        accessory.on('identify', async () => {
            await this.client.identifyDevice!(device.type, device.id);
        });

        accessory.getService(this.Service.AccessoryInformation)!
            .setCharacteristic(this.Characteristic.Name, accessory.displayName)
            .setCharacteristic(this.Characteristic.Manufacturer, 'Ubiquiti Unifi')
            .setCharacteristic(this.Characteristic.Model, device.model)
            .setCharacteristic(this.Characteristic.FirmwareRevision, '0')
            .setCharacteristic(this.Characteristic.SerialNumber, device.id);

        this.devices.push(await Devices[device.type]!.create(this, this.client, accessory, device));
    }

}

export namespace UnifiAccessPlatform {

    export type Config = PlatformConfig & UnifiAccessClient.Config & {
        devices?: Array<{
            id: string;
            asGarageDoor?: string
        }>,
        mqtt?: Mqtt.Config
    }

}