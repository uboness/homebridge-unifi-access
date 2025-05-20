import { UnifiAccess } from '../UnifiAccess';
import { Device } from './Device.js';
import { Door } from './Door';

export * from './Device.js';
export * from './Door';

export const Devices: { [type in UnifiAccess.Device['type']]?: Device.Factory } = {
    'door': Door
}