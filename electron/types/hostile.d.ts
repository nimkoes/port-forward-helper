declare module 'hostile' {
  export function set(ip: string, host: string, cb: (err: Error | null) => void): void
  export function remove(ip: string, host: string, cb: (err: Error | null) => void): void
}

