import { contextBridge, ipcRenderer } from 'electron'

// preload 스크립트가 로드되었는지 확인
console.log('[Preload] Preload script loaded')

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // kubectl 명령어 실행
    execKubectl: (args: string[]) => ipcRenderer.invoke('exec-kubectl', args),
    
    // 포트포워딩 시작
    startPortForward: (context: string, namespace: string, pod: string, localPort: number, remotePort: number) =>
      ipcRenderer.invoke('start-port-forward', { context, namespace, pod, localPort, remotePort }),
    
    // 포트포워딩 중지
    stopPortForward: (pid: number) => ipcRenderer.invoke('stop-port-forward', pid),
    
    // 실행 중인 포트포워딩 목록 조회
    getActivePortForwards: () => ipcRenderer.invoke('get-active-port-forwards'),
    
    // 프록시 서버 시작
    startProxyServer: (preferredPort?: number) => ipcRenderer.invoke('start-proxy-server', preferredPort),
    
    // 프록시 서버 중지
    stopProxyServer: () => ipcRenderer.invoke('stop-proxy-server'),
    
    // 프록시 서버 라우팅 업데이트
    updateProxyRoutes: (routes: Record<string, number>) => ipcRenderer.invoke('update-proxy-routes', routes),
    
    // 프록시 서버 포트 조회
    getProxyServerPort: () => ipcRenderer.invoke('get-proxy-server-port'),
    
    // hosts 파일에 도메인 추가
    addHostsDomain: (domain: string) => ipcRenderer.invoke('add-hosts-domain', domain),
    
    // hosts 파일에서 도메인 제거
    removeHostsDomain: (domain: string) => ipcRenderer.invoke('remove-hosts-domain', domain),
    
    // hosts 파일 도메인 목록 업데이트
    updateHostsDomains: (domains: string[]) => ipcRenderer.invoke('update-hosts-domains', domains),
    
    // Kubernetes Client로 컨텍스트 목록 조회
    getK8sContexts: () => ipcRenderer.invoke('get-k8s-contexts'),
    
    // Kubernetes Client로 네임스페이스 목록 조회
    getK8sNamespaces: (context: string) => ipcRenderer.invoke('get-k8s-namespaces', context),
    
    // Kubernetes Client로 Pod 목록 조회
    getK8sPods: (context: string, namespace: string) => ipcRenderer.invoke('get-k8s-pods', context, namespace),
    
    // Kubernetes Client로 Deployment 목록 조회
    getK8sDeployments: (context: string) => ipcRenderer.invoke('get-k8s-deployments', context),
    
    // Kubernetes Client로 Service 목록 조회
    getK8sServices: (context: string, namespace: string) => ipcRenderer.invoke('get-k8s-services', context, namespace),
    
    // Kubernetes Client로 모든 namespace의 Pod 목록 조회 (최적화)
    getK8sPodsAll: (context: string) => ipcRenderer.invoke('get-k8s-pods-all', context),
    
    // Kubernetes Client로 모든 namespace의 Service 목록 조회 (최적화)
    getK8sServicesAll: (context: string) => ipcRenderer.invoke('get-k8s-services-all', context),
    
    // Service 포트포워딩 시작
    startServicePortForward: (config: {
      context: string
      namespace: string
      serviceName: string
      servicePort: number
      targetPort: number | string
      podName: string
      podPort: number
    }) => ipcRenderer.invoke('start-service-port-forward', config),
  })
  console.log('[Preload] electronAPI exposed successfully')
} catch (error) {
  console.error('[Preload] Error exposing electronAPI:', error)
}

