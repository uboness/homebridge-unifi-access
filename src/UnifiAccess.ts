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
        locked: boolean
    }

    export type Message = DoorUnlocked | DoorUpdate | DoorAccess;

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

    export type DoorUpdate = {
        type: 'door-update',
        id: string,
        name: string,
        locked: boolean,
        available: boolean
    }

    export type DoorAccess = {
        type: 'door-access',
        door: {
            id: string,
            name: string,
        },
        actor: {
            id: string,
            type: string,
            name: string,
            auth: string
        }
    }

}