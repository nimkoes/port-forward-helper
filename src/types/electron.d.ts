export interface ElectronAPI {
  execKubectl: (args: string[]) => Promise<{
    success: boolean
    output: string | null
    error: string | null
  }>
  startPortForward: (
    context: string,
    namespace: string,
    pod: string,
    localPort: number,
    remotePort: number
  ) => Promise<{
    success: boolean
    pid: number | null
    error: string | null
  }>
  stopPortForward: (pid: number) => Promise<{
    success: boolean
    error: string | null
  }>
  getActivePortForwards: () => Promise<{
    success: boolean
    forwards: Array<{ pid: number; killed: boolean }>
  }>
  startProxyServer: (preferredPort?: number) => Promise<{
    success: boolean
    port: number | null
    error: string | null
  }>
  stopProxyServer: () => Promise<{
    success: boolean
    error: string | null
  }>
  updateProxyRoutes: (routes: Record<string, number>) => Promise<{
    success: boolean
    error: string | null
  }>
  addHostsDomain: (domain: string) => Promise<{
    success: boolean
    error: string | null
  }>
  removeHostsDomain: (domain: string) => Promise<{
    success: boolean
    error: string | null
  }>
  updateHostsDomains: (domains: string[]) => Promise<{
    success: boolean
    error: string | null
  }>
  getProxyServerPort: () => Promise<{
    success: boolean
    port: number | null
    error: string | null
  }>
  getK8sContexts: () => Promise<{
    success: boolean
    contexts: Array<{
      name: string
      cluster: string
      authInfo: string
      namespace?: string
      current: boolean
    }>
    error: string | null
  }>
  getK8sNamespaces: (context: string) => Promise<{
    success: boolean
    namespaces: Array<{
      name: string
      status: string
      age: string
    }>
    error: string | null
  }>
  getK8sPods: (context: string, namespace: string) => Promise<{
    success: boolean
    pods: Array<{
      name: string
      namespace: string
      status: string
      age: string
      ports: Array<{
        name?: string
        containerPort: number
        protocol: string
      }>
      deployment?: string
    }>
    error: string | null
  }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

