import type { KubernetesContext, Namespace, Pod, ContainerPort, Deployment, Service } from '@/types'
import { EXCLUDED_NAMESPACES } from '@/constants/namespaces'
import { calculateAge } from './date'
import { extractDeploymentName } from './pod'

export async function getContexts(): Promise<KubernetesContext[]> {
  // electronAPI가 로드될 때까지 대기 (최대 5초)
  let retries = 50
  while (!window.electronAPI && retries > 0) {
    await new Promise(resolve => setTimeout(resolve, 100))
    retries--
  }

  if (!window.electronAPI) {
    console.error('window.electronAPI is not available')
    throw new Error('Electron API가 사용할 수 없습니다. Electron 환경에서 실행해주세요.')
  }

  // Kubernetes Client를 사용하여 컨텍스트 조회
  if (window.electronAPI.getK8sContexts) {
    try {
      const result = await window.electronAPI.getK8sContexts()
      if (result.success) {
        return result.contexts
      } else {
        throw new Error(result.error || '컨텍스트 조회 실패')
      }
    } catch (error: any) {
      console.warn('[kubectl] Failed to use Kubernetes Client, falling back to kubectl command:', error)
      // Fallback to kubectl command
    }
  }

  // Fallback: kubectl 명령어 사용
  const result = await window.electronAPI.execKubectl(['config', 'get-contexts'])
  
  if (!result.success || !result.output) {
    throw new Error(result.error || '컨텍스트 조회 실패')
  }

  // 현재 컨텍스트 확인
  const currentResult = await window.electronAPI.execKubectl(['config', 'current-context'])
  const currentContextName = currentResult.success && currentResult.output 
    ? currentResult.output.trim() 
    : null

  // 출력 파싱: 헤더 라인 제거하고 각 컨텍스트 정보 추출
  const lines = result.output.trim().split('\n')
  const contexts: KubernetesContext[] = []
  
  // 첫 번째 라인은 헤더이므로 건너뛰기
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // 컬럼 분리 (공백으로 구분, 하지만 컬럼 간 공백이 여러 개일 수 있음)
    const parts = line.split(/\s+/).filter(p => p.length > 0)
    
    if (parts.length >= 3) {
      const isCurrent = parts[0] === '*'
      const name = isCurrent ? parts[1] : parts[0]
      const cluster = isCurrent ? parts[2] : parts[1]
      const authInfo = isCurrent ? (parts[3] || '') : (parts[2] || '')
      const namespace = isCurrent ? (parts[4] || undefined) : (parts[3] || undefined)

      contexts.push({
        name,
        cluster,
        authInfo,
        namespace,
        current: name === currentContextName || isCurrent,
      })
    }
  }

  return contexts
}

export async function getNamespaces(context: string): Promise<Namespace[]> {
  if (!window.electronAPI) {
    throw new Error('Electron API가 사용할 수 없습니다')
  }

  // Kubernetes Client를 사용하여 네임스페이스 조회
  if (window.electronAPI.getK8sNamespaces) {
    try {
      const result = await window.electronAPI.getK8sNamespaces(context)
      if (result.success) {
        return result.namespaces.filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name)) // 제외할 namespace 필터링
      } else {
        throw new Error(result.error || '네임스페이스 조회 실패')
      }
    } catch (error: any) {
      console.warn('[kubectl] Failed to use Kubernetes Client, falling back to kubectl command:', error)
      // Fallback to kubectl command
    }
  }

  // Fallback: kubectl 명령어 사용
  const result = await window.electronAPI.execKubectl([
    '--context', context,
    'get', 'namespaces',
    '-o', 'json'
  ])

  if (!result.success || !result.output) {
    throw new Error(result.error || '네임스페이스 조회 실패')
  }

  try {
    const data = JSON.parse(result.output)
    const namespaces: Namespace[] = (data.items || []).map((item: any) => ({
      name: item.metadata?.name || '',
      status: item.status?.phase || 'Unknown',
      age: calculateAge(item.metadata?.creationTimestamp),
    }))

    return namespaces.filter(ns => ns.name.length > 0 && !EXCLUDED_NAMESPACES.includes(ns.name)) // 제외할 namespace 필터링
  } catch (error) {
    throw new Error('네임스페이스 데이터 파싱 실패')
  }
}

export async function getPods(context: string, namespace: string): Promise<Pod[]> {
  if (!window.electronAPI) {
    throw new Error('Electron API가 사용할 수 없습니다')
  }

  // namespace 검증 (빈 문자열이나 공백만 있는 경우도 체크)
  if (!namespace || typeof namespace !== 'string' || namespace.trim() === '') {
    console.warn('[kubectl] Invalid namespace provided:', namespace)
    return [] // 빈 배열 반환하여 에러 대신 처리
  }

  // Kubernetes Client를 사용하여 Pod 조회
  if (window.electronAPI.getK8sPods) {
    try {
      const result = await window.electronAPI.getK8sPods(context, namespace.trim())
      if (result.success) {
        return result.pods
      } else {
        throw new Error(result.error || 'Pod 조회 실패')
      }
    } catch (error: any) {
      // 실제 에러 로깅
      console.error('[kubectl] getPods Kubernetes Client error:', {
        namespace,
        context,
        errorMessage: error.message,
        errorCode: error.code,
        errorStatus: error.statusCode
      })
      
      // namespace 관련 에러인 경우 빈 배열 반환
      if (error.message && error.message.includes('namespace was null or undefined')) {
        console.warn('[kubectl] Namespace validation failed, returning empty array:', namespace)
        return []
      }
      console.warn('[kubectl] Failed to use Kubernetes Client, falling back to kubectl command:', error)
      // Fallback to kubectl command
    }
  }

  // Fallback: kubectl 명령어 사용
  const result = await window.electronAPI.execKubectl([
    '--context', context,
    'get', 'pods',
    '-n', namespace,
    '-o', 'json'
  ])

  if (!result.success || !result.output) {
    throw new Error(result.error || 'Pod 조회 실패')
  }

  try {
    const data = JSON.parse(result.output)
    const pods: Pod[] = []

    for (const item of data.items || []) {
      const podName = item.metadata?.name || ''
      if (!podName) continue

      // Pod 상태 확인
      const status = item.status?.phase || 'Unknown'
      const age = calculateAge(item.metadata?.creationTimestamp)

      // 컨테이너 포트 정보 추출
      const ports: ContainerPort[] = []
      
      // spec.containers에서 ports 추출
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

      pods.push({
        name: podName,
        namespace,
        status,
        age,
        ports,
        deployment,
      })
    }

    return pods
  } catch (error) {
    throw new Error('Pod 데이터 파싱 실패')
  }
}

import { calculateAge } from './date'


export async function getDeployments(context: string): Promise<Deployment[]> {
  if (!window.electronAPI) {
    throw new Error('Electron API가 사용할 수 없습니다')
  }

  // Kubernetes Client를 사용하여 Deployment 조회
  if (window.electronAPI.getK8sDeployments) {
    try {
      const result = await window.electronAPI.getK8sDeployments(context)
      if (result.success) {
        return result.deployments
      } else {
        throw new Error(result.error || 'Deployment 조회 실패')
      }
    } catch (error: any) {
      console.warn('[kubectl] Failed to use Kubernetes Client, falling back to kubectl command:', error)
      // Fallback to kubectl command
    }
  }

  // Fallback: kubectl 명령어 사용
  const result = await window.electronAPI.execKubectl([
    '--context', context,
    'get', 'deployments',
    '--all-namespaces',
    '-o', 'json'
  ])

  if (!result.success || !result.output) {
    throw new Error(result.error || 'Deployment 조회 실패')
  }

  try {
    const data = JSON.parse(result.output)
    const deployments: Deployment[] = []

    for (const item of data.items || []) {
      const name = item.metadata?.name || ''
      const namespace = item.metadata?.namespace || ''
      
      if (!name || !namespace) continue
      
      // 제외할 namespace 제외
      if (EXCLUDED_NAMESPACES.includes(namespace)) continue
      
      deployments.push({ name, namespace })
    }

    return deployments
  } catch (error) {
    throw new Error('Deployment 데이터 파싱 실패')
  }
}

export async function getServices(context: string, namespace: string): Promise<Service[]> {
  if (!window.electronAPI) {
    throw new Error('Electron API가 사용할 수 없습니다')
  }

  // 제외할 namespace 제외
  if (EXCLUDED_NAMESPACES.includes(namespace)) {
    return []
  }

  // Kubernetes Client를 사용하여 Service 조회
  if (window.electronAPI.getK8sServices) {
    try {
      const result = await window.electronAPI.getK8sServices(context, namespace.trim())
      if (result.success) {
        return result.services
      } else {
        throw new Error(result.error || 'Service 조회 실패')
      }
    } catch (error: any) {
      // 실제 에러 로깅
      console.error('[kubectl] getServices Kubernetes Client error:', {
        namespace,
        context,
        errorMessage: error.message,
        errorCode: error.code,
        errorStatus: error.statusCode
      })
      
      console.warn('[kubectl] Failed to use Kubernetes Client, falling back to kubectl command:', error)
      // Fallback to kubectl command
    }
  }

  // Fallback: kubectl 명령어 사용
  const result = await window.electronAPI.execKubectl([
    '--context', context,
    'get', 'services',
    '-n', namespace,
    '-o', 'json'
  ])

  if (!result.success || !result.output) {
    throw new Error(result.error || 'Service 조회 실패')
  }

  try {
    const data = JSON.parse(result.output)
    const services: Service[] = []

    for (const item of data.items || []) {
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

    return services
  } catch (error) {
    throw new Error('Service 데이터 파싱 실패')
  }
}
