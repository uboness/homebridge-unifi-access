import { Detachables } from '../common';
import { UnifiAccess } from '../UnifiAccess';
import { UnifiAccessClient } from '../UnifiAccessClient';
import { UnifiAccessPlatform } from '../UnifiAccessPlatform.js';
import { Characteristic, PlatformAccessory, Service } from 'homebridge';
import { ILogger } from '../Logger.js';

export abstract class Device<D extends UnifiAccess.Device = UnifiAccess.Device> {

    readonly platform: UnifiAccessPlatform;
    readonly client: UnifiAccessClient;
    readonly accessory: PlatformAccessory;
    readonly primaryService: Service;
    readonly device: D;
    readonly logger: ILogger;

    protected statusFault: Characteristic;

    protected readonly detachables = new Detachables();

    protected constructor(platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: D, primaryService: Service) {
        this.platform = platform;
        this.client = client;
        this.accessory = accessory;
        this.device = device;
        this.logger = platform.logger.getLogger(this.type, this.name);
        this.primaryService = primaryService;
        this.primaryService.setPrimaryService(true);
        this.primaryService.setCharacteristic(platform.Characteristic.Name, accessory.displayName);

        this.primaryService.addOptionalCharacteristic(platform.Characteristic.StatusFault);

        this.statusFault = this.primaryService.getCharacteristic(platform.Characteristic.StatusFault) ?? this.primaryService.addCharacteristic(platform.Characteristic.StatusFault);
        this.statusFault.setValue(true);

        this.detachables.add(client.on('message', (message) => {
            this.onMessage(message, platform);
        }));
    }

    get id() {
        return this.device.id;
    }

    get type() {
        return this.device.type;
    }

    get name() {
        return this.device.name;
    }

    async close() {
        this.detachables.detach();
        await this.doClose();
    }

    abstract onMessage(msg: UnifiAccess.Message, platform: UnifiAccessPlatform): void;

    abstract update(device: D): void;

    abstract doClose(): Promise<void>;
}

export namespace Device {

    export type Factory<D extends Device = Device> = {
        create: (platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Device) => Promise<D>
    }

}