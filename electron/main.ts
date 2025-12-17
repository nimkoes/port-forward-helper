import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { exec, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { config } from 'dotenv'
import { KubeConfig, CoreV1Api, AppsV1Api, PortForward } from '@kubernetes/client-node'
import net from 'net'
import portfinder from 'portfinder'
import * as proxyServer from './proxy-server'
import { HostsManager } from './hosts-manager'

// .env 파일 로드
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const envPath = join(__dirname, '../../.env')
if (existsSync(envPath)) {
  config({ path: envPath })
  console.log('[Main] Loaded .env file from:', envPath)
}

const execAsync = promisify(exec)

let mainWindow: BrowserWindow | null = null

// 포트포워딩 프로세스 추적
const portForwardProcesses = new Map<number, ChildProcess>()

// Hosts 매니저 인스턴스
const hostsManager = new HostsManager()

// Kubernetes Client 인스턴스 (컨텍스트별로 관리)
const kubeConfigs = new Map<string, { kc: KubeConfig; k8sApi: CoreV1Api; appsApi: AppsV1Api; forwarder: PortForward }>()

// 포트포워딩 서버 추적 (Kubernetes Client 사용)
const portForwardServers = new Map<number, net.Server>()

// Kubernetes Client 초기화
function getKubeClient(context: string) {
  if (!kubeConfigs.has(context)) {
    const kc = new KubeConfig()
    kc.loadFromDefault()
    kc.setCurrentContext(context)
    const k8sApi = kc.makeApiClient(CoreV1Api)
    const appsApi = kc.makeApiClient(AppsV1Api)
    const forwarder = new PortForward(kc)
    kubeConfigs.set(context, { kc, k8sApi, appsApi, forwarder })
  }
  return kubeConfigs.get(context)!
}

function createWindow() {
  const isDev = process.env.NODE_ENV === 'development'
  
  // 절대 경로로 preload 파일 찾기
  let preloadPath: string
  if (isDev) {
    // 개발 모드: 프로젝트 루트 기준으로 찾기
    const projectRoot = join(__dirname, '../../')
    // .mjs 대신 .js로 변경
    const devPreloadPath = join(projectRoot, 'out/preload/preload.js')
    if (existsSync(devPreloadPath)) {
      preloadPath = devPreloadPath
    } else {
      // 상대 경로로 시도
      preloadPath = join(__dirname, '../preload/preload.js')
    }
  } else {
    preloadPath = join(__dirname, 'preload.js')
  }

  console.log('[Main] Preload path:', preloadPath)
  console.log('[Main] Preload path exists:', existsSync(preloadPath))
  
  if (!existsSync(preloadPath)) {
    console.error('[Main] ERROR: Preload file not found at:', preloadPath)
    console.error('[Main] __dirname:', __dirname)
    console.error('[Main] Current working directory:', process.cwd())
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // preload 스크립트 로드 확인
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Page loaded, checking electronAPI...')
    // executeJavaScript는 개발자 도구가 열려있지 않으면 실패할 수 있으므로 안전하게 처리
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.electronAPI ? "API available" : "API not available"')
          .then(result => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              console.log('[Main] electronAPI check:', result)
            }
          })
          .catch(err => {
            // EPIPE 에러는 무시 (개발자 도구가 닫혀있을 때 발생)
            if (err.code !== 'EPIPE') {
              console.error('[Main] electronAPI check error:', err)
            }
          })
      }
    }, 1000) // 페이지 로드 후 1초 대기
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // 개발자 도구는 수동으로 열도록 (Cmd+Option+I 또는 F12)
    // mainWindow.webContents.openDevTools()
  } else {
    // 프로덕션 빌드: dist/renderer/index.html
    mainWindow.loadFile(join(__dirname, '../dist/renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// kubectl 명령어 실행 (하위 호환성을 위해 유지)
ipcMain.handle('exec-kubectl', async (_, args: string[]) => {
  try {
    const command = `kubectl ${args.join(' ')}`
    const { stdout, stderr } = await execAsync(command)
    if (stderr && !stdout) {
      throw new Error(stderr)
    }
    return { success: true, output: stdout, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      output: null, 
      error: error.message || String(error) 
    }
  }
})

// Kubernetes Client로 컨텍스트 목록 조회
ipcMain.handle('get-k8s-contexts', async () => {
  try {
    const kc = new KubeConfig()
    kc.loadFromDefault()
    const contexts = kc.getContexts()
    const currentContext = kc.getCurrentContext()
    
    return {
      success: true,
      contexts: contexts.map((ctx: any) => ({
        name: ctx.name || '',
        cluster: ctx.cluster || '',
        authInfo: ctx.user || '',
        namespace: ctx.namespace,
        current: ctx.name === currentContext,
      })),
      error: null,
    }
  } catch (error: any) {
    return {
      success: false,
      contexts: [],
      error: error.message || String(error),
    }
  }
})

// Kubernetes Client로 네임스페이스 목록 조회
ipcMain.handle('get-k8s-namespaces', async (_, context: string) => {
  try {
    const { k8sApi } = getKubeClient(context)
    const res = await k8sApi.listNamespace()
    
    const items = (res as any).body?.items || (res as any).items || []
    const namespaces = items.map((item: any) => {
      const creationTimestamp = item.metadata?.creationTimestamp
      const age = creationTimestamp
        ? calculateAge(creationTimestamp)
        : 'Unknown'
      
      return {
        name: item.metadata?.name || '',
        status: item.status?.phase || 'Unknown',
        age,
      }
    })

    return {
      success: true,
      namespaces: namespaces.filter((ns: any) => ns.name.length > 0),
      error: null,
    }
  } catch (error: any) {
    return {
      success: false,
      namespaces: [],
      error: error.message || String(error),
    }
  }
})

// Kubernetes Client로 Pod 목록 조회
ipcMain.handle('get-k8s-pods', async (_, context: string, namespace: string) => {
  console.log(`[Main] get-k8s-pods handler called with context: "${context}", namespace: "${namespace}"`)
  try {
    // namespace 검증
    if (!namespace || typeof namespace !== 'string' || namespace.trim() === '') {
      console.warn('[Main] Invalid namespace provided to get-k8s-pods:', namespace)
      return {
        success: false,
        pods: [],
        error: `Invalid namespace: ${namespace}`,
      }
    }

    const trimmedNamespace = namespace.trim()
    
    // 제외할 namespace 제외
    if (EXCLUDED_NAMESPACES.includes(trimmedNamespace)) {
      console.log(`[Main] Namespace "${trimmedNamespace}" is excluded, returning empty array`)
      return {
        success: true,
        pods: [],
        error: null,
      }
    }

    const { k8sApi } = getKubeClient(context)
    
    console.log(`[Main] Calling listNamespacedPod with namespace: "${trimmedNamespace}"`)
    console.log(`[Main] trimmedNamespace type: ${typeof trimmedNamespace}, value: "${trimmedNamespace}"`)
    let res: any
    try {
      // Kubernetes client-node의 최신 버전에서는 옵션 객체를 받습니다
      if (typeof trimmedNamespace !== 'string' || trimmedNamespace.length === 0) {
        throw new Error(`Invalid namespace: ${trimmedNamespace}`)
      }
      res = await k8sApi.listNamespacedPod({ namespace: trimmedNamespace } as any)
    } catch (apiError: any) {
      console.error(`[Main] listNamespacedPod API call failed:`, apiError)
      console.error(`[Main] Error details:`, {
        message: apiError.message,
        code: apiError.code,
        statusCode: apiError.statusCode,
        body: apiError.body
      })
      throw apiError
    }
    
    const items = (res as any).body?.items || (res as any).items || []
    const pods = []
    for (const item of items) {
      const podName = item.metadata?.name || ''
      if (!podName) continue

      const status = item.status?.phase || 'Unknown'
      const creationTimestamp = item.metadata?.creationTimestamp
      const age = creationTimestamp
        ? calculateAge(creationTimestamp)
        : 'Unknown'

      // 컨테이너 포트 정보 추출
      const ports = []
      const containers = item.spec?.containers || []
      for (const container of containers) {
        const containerPorts = container.ports || []
        for (const port of containerPorts) {
          ports.push({
            name: port.name || undefined,
            containerPort: port.containerPort,
            protocol: port.protocol || 'TCP',
          })
        }
      }

      // Deployment 이름 추출
      const deployment = extractDeploymentName(item)

      // Labels 추출
      const labels = item.metadata?.labels || {}

      // Spec 정보 추출 (포트 매칭을 위해 필요)
      const spec = {
        containers: (item.spec?.containers || []).map((container: any) => ({
          ports: (container.ports || []).map((port: any) => ({
            name: port.name || undefined,
            containerPort: port.containerPort,
            protocol: port.protocol || 'TCP',
          })),
        })),
      }

      pods.push({
        name: podName,
        namespace,
        status,
        age,
        ports,
        deployment,
        creationTimestamp: creationTimestamp || undefined,
        labels,
        spec,
      })
    }

    return {
      success: true,
      pods,
      error: null,
    }
  } catch (error: any) {
    return {
      success: false,
      pods: [],
      error: error.message || String(error),
    }
  }
})

// 제외할 namespace 목록 (시스템 + 사용자 지정)
const EXCLUDED_NAMESPACES = [
  // 시스템 namespace
  'kube-system',
  'kube-public',
  'kube-node-lease',
  // 사용자 지정 제외 namespace
  'default',
  'argocd',
  'azp',
  'calico-system',
  'gateway',
  'migx',
  'projectcontour',
  'submarine',
  'submarine-acct',
  'test-ui',
  'tigera-operator',
]

// Kubernetes Client로 모든 namespace의 Pod 목록 조회 (최적화)
ipcMain.handle('get-k8s-pods-all', async (_, context: string) => {
  console.log(`[Main] get-k8s-pods-all handler called with context: "${context}"`)
  try {
    const { k8sApi } = getKubeClient(context)
    
    console.log(`[Main] Calling listPodForAllNamespaces`)
    let res: any
    try {
      res = await k8sApi.listPodForAllNamespaces()
    } catch (apiError: any) {
      console.error(`[Main] listPodForAllNamespaces API call failed:`, apiError)
      throw apiError
    }
    
    const items = (res as any).body?.items || (res as any).items || []
    const pods = []
    for (const item of items) {
      const podName = item.metadata?.name || ''
      const namespace = item.metadata?.namespace || ''
      if (!podName || !namespace) continue

      // 제외할 namespace 제외
      if (EXCLUDED_NAMESPACES.includes(namespace)) continue

      const status = item.status?.phase || 'Unknown'
      const creationTimestamp = item.metadata?.creationTimestamp
      const age = creationTimestamp
        ? calculateAge(creationTimestamp)
        : 'Unknown'

      // 컨테이너 포트 정보 추출
      const ports = []
      const containers = item.spec?.containers || []
      for (const container of containers) {
        const containerPorts = container.ports || []
        for (const port of containerPorts) {
          ports.push({
            name: port.name || undefined,
            containerPort: port.containerPort,
            protocol: port.protocol || 'TCP',
          })
        }
      }

      // Deployment 이름 추출
      const deployment = extractDeploymentName(item)

      // Labels 추출
      const labels = item.metadata?.labels || {}

      // Spec 정보 추출 (포트 매칭을 위해 필요)
      const spec = {
        containers: (item.spec?.containers || []).map((container: any) => ({
          ports: (container.ports || []).map((port: any) => ({
            name: port.name || undefined,
            containerPort: port.containerPort,
            protocol: port.protocol || 'TCP',
          })),
        })),
      }

      pods.push({
        name: podName,
        namespace,
        status,
        age,
        ports,
        deployment,
        creationTimestamp,
        labels,
        spec,
      })
    }

    console.log(`[Main] get-k8s-pods-all: Found ${pods.length} pods across all namespaces`)
    return {
      success: true,
      pods,
      error: null,
    }
  } catch (error: any) {
    console.error(`[Main] get-k8s-pods-all error:`, error)
    return {
      success: false,
      pods: [],
      error: error.message || String(error),
    }
  }
})

// Kubernetes Client로 모든 namespace의 Service 목록 조회 (최적화)
ipcMain.handle('get-k8s-services-all', async (_, context: string) => {
  console.log(`[Main] get-k8s-services-all handler called with context: "${context}"`)
  try {
    const { k8sApi } = getKubeClient(context)
    
    console.log(`[Main] Calling listServiceForAllNamespaces`)
    let res: any
    try {
      res = await k8sApi.listServiceForAllNamespaces()
    } catch (apiError: any) {
      console.error(`[Main] listServiceForAllNamespaces API call failed:`, apiError)
      throw apiError
    }
    
    const items = (res as any).body?.items || (res as any).items || []
    const services = []
    for (const item of items) {
      const name = item.metadata?.name || ''
      const namespace = item.metadata?.namespace || ''
      if (!name || !namespace) continue

      // 제외할 namespace 제외
      if (EXCLUDED_NAMESPACES.includes(namespace)) continue

      const serviceType = item.spec?.type || ''
      // ClusterIP 타입만 필터링
      if (serviceType !== 'ClusterIP') continue

      const clusterIP = item.spec?.clusterIP || ''
      // clusterIP가 None인 경우 (Headless Service) 제외
      if (clusterIP === 'None') continue

      // 포트 정보 추출
      const ports = []
      const servicePorts = item.spec?.ports || []
      for (const port of servicePorts) {
        ports.push({
          name: port.name || undefined,
          port: port.port,
          targetPort: port.targetPort || port.port,
          protocol: port.protocol || 'TCP',
        })
      }

      // Selector 추출
      const selector = item.spec?.selector || {}

      services.push({
        name,
        namespace,
        type: serviceType,
        clusterIP,
        ports,
        selector: Object.keys(selector).length > 0 ? selector : undefined,
      })
    }

    console.log(`[Main] get-k8s-services-all: Found ${services.length} services across all namespaces`)
    return {
      success: true,
      services,
      error: null,
    }
  } catch (error: any) {
    console.error(`[Main] get-k8s-services-all error:`, error)
    return {
      success: false,
      services: [],
      error: error.message || String(error),
    }
  }
})

// Kubernetes Client로 Deployment 목록 조회
ipcMain.handle('get-k8s-deployments', async (_, context: string) => {
  try {
    const { appsApi } = getKubeClient(context)
    const res = await appsApi.listDeploymentForAllNamespaces()
    
    const items = (res as any).body?.items || (res as any).items || []
    const deployments = []
    for (const item of items) {
      const name = item.metadata?.name || ''
      const namespace = item.metadata?.namespace || ''
      
      if (!name || !namespace) continue
      
      // 제외할 namespace 제외
      if (EXCLUDED_NAMESPACES.includes(namespace)) continue
      
      deployments.push({
        name,
        namespace,
      })
    }

    return {
      success: true,
      deployments,
      error: null,
    }
  } catch (error: any) {
    return {
      success: false,
      deployments: [],
      error: error.message || String(error),
    }
  }
})

// Kubernetes Client로 Service 목록 조회
ipcMain.handle('get-k8s-services', async (_, context: string, namespace: string) => {
  console.log(`[Main] get-k8s-services handler called with context: "${context}", namespace: "${namespace}"`)
  try {
    // namespace 검증
    if (!namespace || typeof namespace !== 'string' || namespace.trim() === '') {
      console.warn('[Main] Invalid namespace provided to get-k8s-services:', namespace)
      return {
        success: false,
        services: [],
        error: `Invalid namespace: ${namespace}`,
      }
    }

    const trimmedNamespace = namespace.trim()
    
    // 제외할 namespace 제외
    if (EXCLUDED_NAMESPACES.includes(trimmedNamespace)) {
      console.log(`[Main] Namespace "${trimmedNamespace}" is excluded, returning empty array`)
      return {
        success: true,
        services: [],
        error: null,
      }
    }

    const { k8sApi } = getKubeClient(context)
    
    console.log(`[Main] Calling listNamespacedService with namespace: "${trimmedNamespace}"`)
    console.log(`[Main] trimmedNamespace type: ${typeof trimmedNamespace}, value: "${trimmedNamespace}"`)
    let res: any
    try {
      // Kubernetes client-node의 최신 버전에서는 옵션 객체를 받습니다
      if (typeof trimmedNamespace !== 'string' || trimmedNamespace.length === 0) {
        throw new Error(`Invalid namespace: ${trimmedNamespace}`)
      }
      res = await k8sApi.listNamespacedService({ namespace: trimmedNamespace } as any)
    } catch (apiError: any) {
      console.error(`[Main] listNamespacedService API call failed:`, apiError)
      console.error(`[Main] Error details:`, {
        message: apiError.message,
        code: apiError.code,
        statusCode: apiError.statusCode,
        body: apiError.body
      })
      throw apiError
    }
    
    const items = (res as any).body?.items || (res as any).items || []
    const services = []
    for (const item of items) {
      const name = item.metadata?.name || ''
      if (!name) continue

      // ClusterIP 타입만 필터링
      const serviceType = item.spec?.type || ''
      if (serviceType !== 'ClusterIP') continue

      const clusterIP = item.spec?.clusterIP || ''
      // clusterIP가 None인 경우 (Headless Service) 제외
      if (clusterIP === 'None') continue

      // 포트 정보 추출
      const ports = []
      const servicePorts = item.spec?.ports || []
      for (const port of servicePorts) {
        ports.push({
          name: port.name || undefined,
          port: port.port,
          targetPort: port.targetPort || port.port, // targetPort가 없으면 port 사용
          protocol: port.protocol || 'TCP',
        })
      }

      // Selector 추출
      const selector = item.spec?.selector || {}

      services.push({
        name,
        namespace,
        type: serviceType,
        clusterIP,
        ports,
        selector: Object.keys(selector).length > 0 ? selector : undefined,
      })
    }

    return {
      success: true,
      services,
      error: null,
    }
  } catch (error: any) {
    return {
      success: false,
      services: [],
      error: error.message || String(error),
    }
  }
})

// Service 포트포워딩 시작
ipcMain.handle('start-service-port-forward', async (_, config: {
  context: string
  namespace: string
  serviceName: string
  servicePort: number
  targetPort: number | string
  podName: string
  podPort: number
}) => {
  try {
    const { forwarder } = getKubeClient(config.context)
    
    // portfinder로 사용 가능한 포트 찾기
    const targetLocalPort = await portfinder.getPortPromise()

    // net.Server를 생성하여 포트포워딩
    const server = net.createServer((socket) => {
      forwarder.portForward(config.namespace, config.podName, [config.podPort], socket, null, socket)
    })

    return new Promise((resolve, reject) => {
      server.listen(targetLocalPort, () => {
        console.log(`[Main] Forwarding Service ${config.serviceName}.${config.namespace}:${config.servicePort} -> ${config.context}/${config.namespace}/${config.podName}:${config.podPort} (local: ${targetLocalPort})`)
        // 서버를 추적하기 위해 포트를 키로 사용
        portForwardServers.set(targetLocalPort, server)
        
        resolve({ 
          success: true, 
          pid: targetLocalPort, 
          localPort: targetLocalPort,
          error: null 
        })
      })

      server.on('error', (err) => {
        console.error('[Main] Service port forward server error:', err)
        reject(err)
      })
    })
  } catch (error: any) {
    return { 
      success: false, 
      pid: null,
      localPort: null,
      error: error.message || String(error) 
    }
  }
})

// 유틸리티 함수들
function calculateAge(creationTimestamp: string): string {
  try {
    const created = new Date(creationTimestamp).getTime()
    const now = Date.now()
    const diffMs = now - created
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays}d`
    if (diffHours > 0) return `${diffHours}h`
    if (diffMins > 0) return `${diffMins}m`
    return `${diffSecs}s`
  } catch {
    return 'Unknown'
  }
}

function extractDeploymentName(podItem: any): string {
  try {
    const ownerReferences = podItem.metadata?.ownerReferences || []
    
    // ReplicaSet 찾기
    for (const owner of ownerReferences) {
      if (owner.kind === 'ReplicaSet') {
        // ReplicaSet의 이름에서 Deployment 이름 추출
        const replicaSetName = owner.name || ''
        const lastDashIndex = replicaSetName.lastIndexOf('-')
        if (lastDashIndex > 0) {
          return replicaSetName.substring(0, lastDashIndex)
        }
      }
    }
    
    // Deployment를 찾지 못했으면 Pod 이름 사용
    return podItem.metadata?.name || ''
  } catch (error) {
    return podItem.metadata?.name || ''
  }
}

// 포트포워딩 시작 (Kubernetes Client 사용)
ipcMain.handle('start-port-forward', async (_, config: {
  context: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
}) => {
  try {
    const { forwarder } = getKubeClient(config.context)
    
    // portfinder로 사용 가능한 포트 찾기 (지정된 포트가 사용 중일 수 있음)
    let targetLocalPort = config.localPort
    
    // 포트가 이미 사용 중인지 확인
    if (portForwardServers.has(config.localPort)) {
      // 이미 추적 중인 서버가 있으면 다른 포트 사용
      console.log(`[Main] Port ${config.localPort} is already tracked, finding available port...`)
      targetLocalPort = await portfinder.getPortPromise({ port: config.localPort })
      console.log(`[Main] Using alternative port: ${targetLocalPort}`)
    } else {
      // 포트가 실제로 사용 가능한지 확인
      const isPortInUse = await new Promise<boolean>((resolve) => {
        const testServer = net.createServer()
        testServer.once('error', (err: any) => {
          // EADDRINUSE 에러면 포트가 사용 중
          resolve(err.code === 'EADDRINUSE')
        })
        testServer.once('listening', () => {
          // 포트가 사용 가능하면 즉시 닫기
          testServer.close(() => resolve(false))
        })
        testServer.listen(config.localPort)
      })
      
      if (isPortInUse) {
        // 사용 중이면 자동으로 사용 가능한 포트 찾기
        console.log(`[Main] Port ${config.localPort} is already in use, finding available port...`)
        targetLocalPort = await portfinder.getPortPromise({ port: config.localPort })
        console.log(`[Main] Using alternative port: ${targetLocalPort}`)
      }
    }

    // net.Server를 생성하여 포트포워딩
    const server = net.createServer((socket) => {
      forwarder.portForward(config.namespace, config.pod, [config.remotePort], socket, null, socket)
    })

    return new Promise((resolve, reject) => {
      server.listen(targetLocalPort, () => {
        console.log(`[Main] Forwarding 127.0.0.1:${targetLocalPort} -> ${config.context}/${config.namespace}/${config.pod}:${config.remotePort}`)
        // 서버를 추적하기 위해 포트를 키로 사용
        portForwardServers.set(targetLocalPort, server)
        
        // 실제 PID는 없지만, 포트를 PID처럼 사용
        resolve({ success: true, pid: targetLocalPort, localPort: targetLocalPort, error: null })
      })

      server.on('error', (err: any) => {
        console.error('[Main] Port forward server error:', err)
        // EADDRINUSE 에러인 경우 다른 포트 시도
        if (err.code === 'EADDRINUSE') {
          portfinder.getPortPromise({ port: targetLocalPort })
            .then((newPort) => {
              server.listen(newPort, () => {
                console.log(`[Main] Forwarding 127.0.0.1:${newPort} -> ${config.context}/${config.namespace}/${config.pod}:${config.remotePort} (retry)`)
                portForwardServers.set(newPort, server)
                resolve({ success: true, pid: newPort, localPort: newPort, error: null })
              })
            })
            .catch((retryError) => {
              reject(retryError)
            })
        } else {
          reject(err)
        }
      })
    })
  } catch (error: any) {
    return { 
      success: false, 
      pid: null,
      localPort: null,
      error: error.message || String(error) 
    }
  }
})

// 포트포워딩 중지
ipcMain.handle('stop-port-forward', async (_, pid: number) => {
  try {
    // Kubernetes Client로 생성된 서버인지 확인
    const server = portForwardServers.get(pid)
    if (server) {
      return new Promise((resolve) => {
        server.close(() => {
          portForwardServers.delete(pid)
          console.log(`[Main] Stopped port forward on port ${pid}`)
          resolve({ success: true, error: null })
        })
      })
    }
    
    // 기존 kubectl 프로세스 방식 (하위 호환성)
    const childProcess = portForwardProcesses.get(pid)
    if (childProcess) {
      childProcess.kill()
      portForwardProcesses.delete(pid)
      return { success: true, error: null }
    } else {
      // 프로세스가 맵에 없으면 이미 종료된 것으로 간주
      return { success: true, error: null }
    }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// 실행 중인 포트포워딩 목록 조회
ipcMain.handle('get-active-port-forwards', async () => {
  // kubectl 프로세스 방식 (하위 호환성)
  const kubectlForwards = Array.from(portForwardProcesses.entries()).map(([pid, process]) => ({
    pid,
    killed: process.killed,
  }))
  
  // Kubernetes Client 서버 방식
  const k8sClientForwards = Array.from(portForwardServers.entries()).map(([port, server]) => ({
    pid: port, // 포트를 PID처럼 사용
    killed: !server.listening,
  }))
  
  return { success: true, forwards: [...kubectlForwards, ...k8sClientForwards] }
})

// 프록시 서버 시작
ipcMain.handle('start-proxy-server', async (_, preferredPort?: number) => {
  try {
    const port = await proxyServer.startProxyServer(preferredPort || 80)
    return { success: true, port, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      port: null, 
      error: error.message || String(error) 
    }
  }
})

// 프록시 서버 중지
ipcMain.handle('stop-proxy-server', async () => {
  try {
    await proxyServer.stopProxyServer()
    return { success: true, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// 프록시 서버 라우팅 업데이트
ipcMain.handle('update-proxy-routes', async (_, routes: Record<string, number>) => {
  try {
    const routesMap = new Map<string, number>()
    for (const [domain, port] of Object.entries(routes)) {
      routesMap.set(domain, port)
    }
    proxyServer.updateRoutes(routesMap)
    return { success: true, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// 프록시 서버 포트 조회
ipcMain.handle('get-proxy-server-port', async () => {
  try {
    const port = proxyServer.getServerPort()
    return { success: true, port, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      port: null, 
      error: error.message || String(error) 
    }
  }
})

// hosts 파일에 도메인 추가
ipcMain.handle('add-hosts-domain', async (_, domain: string) => {
  try {
    await hostsManager.addDomain(domain)
    return { success: true, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// hosts 파일에서 도메인 제거
ipcMain.handle('remove-hosts-domain', async (_, domain: string) => {
  try {
    await hostsManager.removeDomain(domain)
    return { success: true, error: null }
  } catch (error: any) {
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

// hosts 파일 도메인 목록 업데이트
ipcMain.handle('update-hosts-domains', async (_, domains: string[]) => {
  try {
    console.log('[Main] update-hosts-domains called with domains:', domains)
    await hostsManager.updateDomains(domains)
    console.log('[Main] update-hosts-domains succeeded')
    return { success: true, error: null }
  } catch (error: any) {
    console.error('[Main] update-hosts-domains failed:', error)
    return { 
      success: false, 
      error: error.message || String(error) 
    }
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// cleanup이 실행 중인지 추적
let isCleaningUp = false

// 정리 함수
const cleanup = async () => {
  if (isCleaningUp) {
    console.log('[Main] Cleanup already in progress, skipping...')
    return
  }
  
  isCleaningUp = true
  console.log('[Main] Shutting down...')
  
  try {
    // 모든 포트포워딩 프로세스 종료 (kubectl 방식)
  portForwardProcesses.forEach((process) => {
      try {
    process.kill()
      } catch (error) {
        // 무시
      }
  })
  portForwardProcesses.clear()

    // 모든 포트포워딩 서버 종료 (Kubernetes Client 방식)
    for (const [port, server] of portForwardServers.entries()) {
      try {
        await new Promise<void>((resolve) => {
          server.close(() => {
            console.log(`[Main] Closed port forward server on port ${port}`)
            resolve()
          })
        })
      } catch (error) {
        // 무시
      }
    }
    portForwardServers.clear()

    // 프록시 서버 종료
    try {
      await proxyServer.stopProxyServer()
    } catch (error) {
      // 무시
    }

    // hosts 파일 정리 (에러가 발생해도 앱 종료는 계속 진행)
    try {
      await hostsManager.cleanup()
    } catch (error) {
      console.error('[Main] Failed to cleanup hosts (non-fatal):', error)
      // 에러가 발생해도 앱 종료는 계속 진행
    }
  } catch (error) {
    console.error('[Main] Error during cleanup:', error)
    // cleanup 중 에러가 발생해도 앱 종료는 계속 진행
  } finally {
    isCleaningUp = false
  }
}

app.on('window-all-closed', async () => {
  await cleanup()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await cleanup()
})

process.on('SIGINT', async () => {
  await cleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(0)
})

process.on('uncaughtException', async (err) => {
  console.error('[Main] Uncaught exception:', err)
  // cleanup이 실패해도 앱은 종료되어야 함
  try {
    await cleanup()
  } catch (cleanupError) {
    console.error('[Main] Error during cleanup after uncaught exception:', cleanupError)
  }
  // cleanup 완료 여부와 관계없이 앱 종료
  setTimeout(() => {
    process.exit(1)
  }, 1000)
})

