export interface KubernetesContext {
  name: string
  cluster: string
  authInfo: string
  namespace?: string
  current: boolean
}

export interface Namespace {
  name: string
  status: string
  age: string
}

export interface ContainerPort {
  name?: string
  containerPort: number
  protocol: string
}

export interface Pod {
  name: string
  namespace: string
  status: string
  age: string
  ports: ContainerPort[]
  deployment?: string
}

export interface PortForwardConfig {
  id: string
  context: string
  namespace: string
  pod: string
  localPort: number
  remotePort: number
  pid?: number
  active: boolean
  domain?: string
}

export interface PortForwardState {
  [context: string]: {
    [namespace: string]: {
      [pod: string]: {
        [remotePort: number]: PortForwardConfig
      }
    }
  }
}

