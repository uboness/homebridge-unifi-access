import { Logging } from 'homebridge';

export type ILogger = Pick<Logging, 'debug' | 'info' | 'warn' | 'error'> & {
    getLogger(category: string, ...categories: string[]): ILogger
}

export class ContextLogger implements ILogger {

    private readonly logger: Omit<ILogger, 'getLogger'>;
    readonly categories: string[];
    readonly context: string;

    constructor(logger: Omit<ILogger, 'getLogger'>, ...categories: string[]) {
        this.logger = logger;
        this.categories = categories;
        this.context = `[${categories.join('] [')}]`;
    }

    debug(message: string, ...parameters: any[]): void {
        this.logger.debug(this.context ? `${this.context} ${message}` : message, ...parameters);
    }

    error(message: string, ...parameters: any[]): void {
        this.logger.error(this.context ? `${this.context} ${message}` : message, ...parameters);
    }

    info(message: string, ...parameters: any[]): void {
        this.logger.info(this.context ? `${this.context} ${message}` : message, ...parameters);
    }

    warn(message: string, ...parameters: any[]): void {
        this.logger.warn(this.context ? `${this.context} ${message}` : message, ...parameters);
    }

    getLogger(category: string, ...categories: string[]): ILogger {
        return new ContextLogger(this.logger, ...[ ...this.categories, category, ...categories ]);
    }
}