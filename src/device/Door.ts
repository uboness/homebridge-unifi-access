import { Characteristic, PlatformAccessory } from 'homebridge';
import { UnifiAccess } from '../UnifiAccess';
import { UnifiAccessClient } from '../UnifiAccessClient';
import { UnifiAccessPlatform } from '../UnifiAccessPlatform.js';
import { Device } from './Device.js';

export namespace Door {
    export const create = async (platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Device) => {
        const asGarageDoor = accessory.context.asGarageDoor;
        if (asGarageDoor) {
            return GarageDoor.create(platform, client, accessory, device);
        }
        return Lock.create(platform, client, accessory, device);
    }
}

class Lock extends Device<UnifiAccess.Door> {

    static readonly create = async (platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Device) => {
        return new Lock(platform, client, accessory, device as UnifiAccess.Door);
    }

    private readonly targetState: Characteristic;
    private readonly currentState: Characteristic;

    private constructor(platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Door) {
        super(platform, client, accessory, device, accessory.getService(platform.Service.LockMechanism) ?? accessory.addService(platform.Service.LockMechanism));

        this.targetState = this.primaryService.getCharacteristic(platform.Characteristic.LockTargetState)
            .setValue(this.device.locked ? platform.Characteristic.LockTargetState.SECURED : platform.Characteristic.LockTargetState.UNSECURED)
            .onSet(async (value, context) => {
                if (!context?.fromUnifi) {
                    const locked = value === platform.Characteristic.LockTargetState.SECURED;
                    if (!locked) {
                        await client.unlockDoor(device.id);
                    }
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
        if (msg.type === 'door-update' && msg.id === this.device.id) {
            if (msg.locked !== undefined) {
                this.device.locked = msg.locked;
                const currestState = msg.locked ? platform.Characteristic.LockCurrentState.SECURED : platform.Characteristic.LockCurrentState.UNSECURED;
                this.currentState.setValue(currestState, { fromUnifi: true });
                const targetState = msg.locked ? platform.Characteristic.LockTargetState.SECURED : platform.Characteristic.LockTargetState.UNSECURED;
                this.targetState.setValue(targetState, { fromUnifi: true });
            }
            this.statusFault.setValue(!msg.available);
        }
    }

}

class GarageDoor extends Device<UnifiAccess.Door> {

    static readonly create = async (platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Device) => {
        return new GarageDoor(platform, client, accessory, device as UnifiAccess.Door);
    }

    private readonly currentState: Characteristic;
    private readonly targetState: Characteristic;

    private constructor(platform: UnifiAccessPlatform, client: UnifiAccessClient, accessory: PlatformAccessory, device: UnifiAccess.Door) {
        super(platform, client, accessory, device, accessory.getService(platform.Service.GarageDoorOpener) ?? accessory.addService(platform.Service.GarageDoorOpener));

        this.targetState = this.primaryService.getCharacteristic(platform.Characteristic.TargetDoorState)
            .setValue(this.device.locked ? platform.Characteristic.TargetDoorState.CLOSED : platform.Characteristic.TargetDoorState.OPEN)
            .onSet(async (value, context) => {
                const locked = value === platform.Characteristic.TargetDoorState.CLOSED;
                if (!context?.fromUnifi) {
                    if (!locked) {
                        this.currentState.setValue(platform.Characteristic.CurrentDoorState.OPEN);
                        await client.unlockDoor(device.id);
                    }
                }
                if (locked) {
                    this.currentState.setValue(platform.Characteristic.CurrentDoorState.CLOSED)
                }
            });

        this.currentState = this.primaryService.getCharacteristic(platform.Characteristic.CurrentDoorState)
            .setValue(platform.Characteristic.CurrentDoorState.CLOSED);
    }

    update(door: UnifiAccess.Door) {
        this.device.locked = door.locked;
    }

    async doClose(){
    }

    onMessage(msg: UnifiAccess.Message, platform: UnifiAccessPlatform) {
        if (msg.type === 'door-update' && msg.id === this.device.id) {
            if (msg.locked !== undefined) {
                this.device.locked = msg.locked;
                const currestState = msg.locked ? platform.Characteristic.CurrentDoorState.CLOSED : platform.Characteristic.CurrentDoorState.OPEN;
                this.currentState.setValue(currestState, { fromUnifi: true });
                const targetState = msg.locked ? platform.Characteristic.TargetDoorState.CLOSED : platform.Characteristic.TargetDoorState.OPEN;
                this.targetState.setValue(targetState, { fromUnifi: true });
            }
            this.statusFault.setValue(!msg.available);
        }
    }

}