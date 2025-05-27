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

    export type Message = DoorUpdate | DoorAccess;

    export type DoorUpdate = {
        type: 'door-update',
        id: string,
        name: string,
        locked?: boolean,
        available?: boolean
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