import { Characteristic, PlatformAccessory } from 'homebridge';
import { UnifiAccess } from '../UnifiAccess';
import { UnifiAccessClient } from '../UnifiAccessClient';
import { UnifiAccessPlatform } from '../UnifiAccessPlatform.js';
import { Device } from './Device.js';

export class Door extends Device<UnifiAccess.Door> {

    static readonly create = async (platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Device) => {
        return new Door(platform, client, accessory, device as UnifiAccess.Door);
    }

    private readonly targetState: Characteristic;
    private readonly currentState: Characteristic;

    private constructor(platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Door) {
        super(platform, client, accessory, device, accessory.getService(platform.Service.LockMechanism) ?? accessory.addService(platform.Service.LockMechanism));

        this.targetState = this.primaryService.getCharacteristic(platform.Characteristic.LockTargetState)
            .setValue(this.device.locked ? platform.Characteristic.LockTargetState.SECURED : platform.Characteristic.LockTargetState.UNSECURED)
            .onSet(async (value, context) => {
                const locked = value === platform.Characteristic.LockTargetState.SECURED;
                this.device.locked = locked;
                if (locked) {
                    setTimeout(() => this.currentState.setValue(platform.Characteristic.LockCurrentState.SECURED, 5));
                } else if (context?.fromUnifi) {
                    this.currentState.setValue(platform.Characteristic.LockCurrentState.UNSECURED);
                    setTimeout(() => this.targetState.setValue(platform.Characteristic.LockTargetState.SECURED), 500);
                } else {
                    await client.unlockDoor(device.id);
                }
            });

        this.currentState = this.primaryService.getCharacteristic(platform.Characteristic.LockCurrentState)
            .setValue(platform.Characteristic.LockCurrentState.SECURED);
    }

    update(door: UnifiAccess.Door) {
        this.device.locked = door.locked;
    }

    async doClose(){
    }

    onMessage(msg: UnifiAccess.Message, platform: UnifiAccessPlatform) {
        if (msg.type === 'door-unlocked') {
            this.targetState.setValue(platform.Characteristic.LockTargetState.UNSECURED, { fromUnifi: true });
        }
    }

}