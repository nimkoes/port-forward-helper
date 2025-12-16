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
  creationTimestamp?: string
  labels?: Record<string, string>
  spec?: {
    containers?: Array<{
      ports?: Array<{
        name?: string
        containerPort: number
        protocol?: string
      }>
    }>
  }
}

export interface Deployment {
  name: string
  namespace: string
}

export interface ServicePort {
  name?: string
  port: number
  targetPort: number | string
  protocol: string
}

export interface Service {
  name: string
  namespace: string
  type: string
  clusterIP?: string
  ports: ServicePort[]
  selector?: Record<string, string>
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

