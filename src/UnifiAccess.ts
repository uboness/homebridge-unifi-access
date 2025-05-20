export namespace UnifiAccess {

    export type Device = Door

    export type DeviceBase = {
        type: 'door' | 'keypad' | 'intercom' | 'hub',
        id: string,
        name: string,
        model: string
    }

    export type Door = DeviceBase & {
        type: 'door',
        locked: boolean,
        position?: 'open' | 'close'
    }

    export type Message = DoorUnlocked;

    export type DoorUnlocked = {
        type: 'door-unlocked',
        deviceId: string,
        authType: string,
        actor: {
            id: string,
            name: string,
            type: string,
        }
    }
}