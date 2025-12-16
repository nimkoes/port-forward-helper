import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { Server } from 'http'
import portfinder from 'portfinder'

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
    const hostHeader = req.get('host') || req.hostname
    const [host, port] = hostHeader.split(':')
    const requestPort = port ? parseInt(port, 10) : 80
    
    // 라우팅 키 생성: host:port 형식 (포트가 80이면 host만 사용)
    const routeKey = requestPort === 80 ? host : `${host}:${requestPort}`
    
    // 먼저 정확한 키로 찾기
    if (routes.has(routeKey)) {
      const targetPort = routes.get(routeKey)!
      const proxy = createProxyMiddleware({
        target: `http://localhost:${targetPort}`,
        changeOrigin: true,
        logLevel: 'silent',
      })
      return proxy(req, res, next)
    }
    
    // 포트가 80이 아니고 정확한 키를 찾지 못한 경우, host만으로도 시도
    if (requestPort !== 80 && routes.has(host)) {
      const targetPort = routes.get(host)!
      const proxy = createProxyMiddleware({
        target: `http://localhost:${targetPort}`,
        changeOrigin: true,
        logLevel: 'silent',
      })
      return proxy(req, res, next)
    }
    
    // 라우팅이 없으면 404
    res.status(404).send(`No route found for this domain: ${routeKey}`)
  })

  // 포트 시도: preferredPort부터 시작, 실패하면 portfinder로 사용 가능한 포트 찾기
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
      
      return currentPort!
    } catch (error: any) {
      console.warn(`[Proxy Server] Failed to start on port ${port}: ${error.message}`)
      if (server) {
        const serverToClose: Server = server
        serverToClose.close()
        server = null
      }
      // 다음 포트 시도
      continue
    }
  }
  
  // 모든 포트가 실패하면 portfinder로 사용 가능한 포트 찾기
  try {
    console.log(`[Proxy Server] All preferred ports failed, finding available port...`)
    const availablePort = await portfinder.getPortPromise({ port: 8080, stopPort: 9000 })
    
    await new Promise<void>((resolve, reject) => {
      server = app!.listen(availablePort, () => {
        currentPort = availablePort
        console.log(`[Proxy Server] Started on available port ${availablePort}`)
        resolve()
      })
      
      server.on('error', (err: any) => {
        reject(err)
      })
    })
    
    if (!currentPort) {
      throw new Error('Failed to set currentPort after starting server')
    }
    return currentPort
  } catch (error: any) {
    console.error(`[Proxy Server] Failed to start on any available port: ${error.message}`)
    throw new Error('Failed to start proxy server on any port')
  }
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

