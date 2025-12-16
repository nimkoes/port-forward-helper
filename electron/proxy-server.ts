import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { Server } from 'http'

let app: express.Application | null = null
let server: Server | null = null
let currentPort: number | null = null
const routes = new Map<string, number>()

/**
 * 프록시 서버를 시작합니다.
 * @param preferredPort 선호하는 포트 (기본값: 80)
 * @returns 실제 사용된 포트 번호
 */
export async function startProxyServer(preferredPort: number = 80): Promise<number> {
  if (server) {
    return currentPort!
  }

  app = express()
  
  // 동적 라우팅을 위한 미들웨어
  app.use((req, res, next) => {
    const host = req.get('host')?.split(':')[0] || req.hostname
    
    if (host && routes.has(host)) {
      const targetPort = routes.get(host)!
      const proxy = createProxyMiddleware({
        target: `http://localhost:${targetPort}`,
        changeOrigin: true,
        logLevel: 'silent',
      })
      return proxy(req, res, next)
    }
    
    // 라우팅이 없으면 404
    res.status(404).send('No route found for this domain')
  })

  // 포트 시도: preferredPort부터 시작
  const portsToTry = [preferredPort, 8080]
  
  for (const port of portsToTry) {
    try {
      await new Promise<void>((resolve, reject) => {
        server = app!.listen(port, () => {
          currentPort = port
          console.log(`[Proxy Server] Started on port ${port}`)
          resolve()
        })
        
        server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            reject(new Error(`Port ${port} is already in use`))
          } else {
            reject(err)
          }
        })
      })
      
      return currentPort
    } catch (error: any) {
      console.warn(`[Proxy Server] Failed to start on port ${port}: ${error.message}`)
      if (server) {
        server.close()
        server = null
      }
      // 다음 포트 시도
      continue
    }
  }
  
  throw new Error('Failed to start proxy server on any port')
}

/**
 * 프록시 서버를 중지합니다.
 */
export async function stopProxyServer(): Promise<void> {
  if (server) {
    return new Promise<void>((resolve) => {
      server!.close(() => {
        console.log('[Proxy Server] Stopped')
        server = null
        app = null
        currentPort = null
        routes.clear()
        resolve()
      })
    })
  }
}

/**
 * 라우팅을 추가합니다.
 */
export function addRoute(domain: string, localPort: number): void {
  routes.set(domain, localPort)
  console.log(`[Proxy Server] Added route: ${domain} -> localhost:${localPort}`)
}

/**
 * 라우팅을 제거합니다.
 */
export function removeRoute(domain: string): void {
  routes.delete(domain)
  console.log(`[Proxy Server] Removed route: ${domain}`)
}

/**
 * 모든 라우팅을 업데이트합니다.
 */
export function updateRoutes(newRoutes: Map<string, number>): void {
  routes.clear()
  for (const [domain, port] of newRoutes.entries()) {
    routes.set(domain, port)
  }
  console.log(`[Proxy Server] Updated routes: ${routes.size} routes`)
}

/**
 * 현재 프록시 서버 포트를 반환합니다.
 */
export function getServerPort(): number | null {
  return currentPort
}

/**
 * 현재 라우팅 테이블을 반환합니다.
 */
export function getRoutes(): Map<string, number> {
  return new Map(routes)
}

