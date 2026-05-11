const DEV = import.meta.env.DEV

export const log: (...args: unknown[]) => void = DEV ? console.log.bind(console) : () => {}
export const warn: (...args: unknown[]) => void = DEV ? console.warn.bind(console) : () => {}
