export type Detachable = { detach: () => void; }
export type Nil = null | undefined;

export type Promisable<T = void> = T | Promise<T>;

export type ValueCallback<V, R = void> = (value: V) => Promisable<R>;

export const isNil = (value: any): value is Nil => value === null || value === undefined;
export const isUndefined = (value: any): value is undefined => value === undefined;
export const isString = (value: any): value is string => !isNil(value) && typeof value === 'string';
export const isBoolean = (value: any): value is boolean => !isNil(value) && typeof value === 'boolean';
export const isNumber = (value: any): value is number => !isNil(value) && typeof value === 'number';

export type JSON = JSONPrimitive | JSONObject | JSONArray;
export type JSONPrimitive = string | number | boolean | null;
export type JSONArray = JSON[];
export type JSONObject = { [key: string]: JSON };

export const cleanArrayAsync = async <T = any>(array: T[], cb: (value: T) => void | Promise<void>) => {
    while (array.length > 0) {
        const value = array.pop();
        if (value) {
            await cb(value);
        }
    }
}

export const spliceFirstMatch = <T = any>(array: T[], predicate: (value: T) => boolean): T | undefined => {
    const index = array.findIndex(predicate);
    if (index < 0) {
        return;
    }
    const removed = array[index];
    array.splice(index, 1);
    return removed;
}


export class Detachables implements Detachable {

    private detachables: Detachable[];

    constructor(detachables: Detachable[] = []) {
        this.detachables = detachables;
    }

    add(detachable: Detachable): Detachable {
        const _detachable = {
            detach: () => {
                detachable.detach();
                spliceFirstMatch(this.detachables, d => d === _detachable);
            }
        };
        this.detachables.push(_detachable);
        return _detachable;
    }

    remove(detachable: Detachable): void {
        spliceFirstMatch(this.detachables, d => d === detachable);
    }

    detach(): void {
        while (this.detachables.length > 0) {
            try {
                this.detachables.pop()?.detach();
            } catch (e) {
            }
        }
    }

}