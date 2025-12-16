import type { KubernetesContext, Namespace, Pod, ContainerPort } from '@/types'

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
        return result.namespaces
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

    return namespaces.filter(ns => ns.name.length > 0)
  } catch (error) {
    throw new Error('네임스페이스 데이터 파싱 실패')
  }
}

export async function getPods(context: string, namespace: string): Promise<Pod[]> {
  if (!window.electronAPI) {
    throw new Error('Electron API가 사용할 수 없습니다')
  }

  // Kubernetes Client를 사용하여 Pod 조회
  if (window.electronAPI.getK8sPods) {
    try {
      const result = await window.electronAPI.getK8sPods(context, namespace)
      if (result.success) {
        return result.pods
      } else {
        throw new Error(result.error || 'Pod 조회 실패')
      }
    } catch (error: any) {
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

function calculateAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return 'Unknown'

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

/**
 * Pod의 metadata에서 Deployment 이름을 추출합니다.
 * ownerReferences를 통해 ReplicaSet을 찾고, ReplicaSet의 ownerReferences에서 Deployment를 찾습니다.
 * Deployment를 찾지 못하면 Pod 이름을 반환합니다.
 */
function extractDeploymentName(podItem: any): string {
  try {
    const ownerReferences = podItem.metadata?.ownerReferences || []
    
    // ReplicaSet 찾기
    for (const owner of ownerReferences) {
      if (owner.kind === 'ReplicaSet') {
        // ReplicaSet의 이름에서 Deployment 이름 추출
        // ReplicaSet 이름 형식: <deployment-name>-<hash>
        const replicaSetName = owner.name || ''
        // 마지막 하이픈을 기준으로 분리하여 Deployment 이름 추출
        const lastDashIndex = replicaSetName.lastIndexOf('-')
        if (lastDashIndex > 0) {
          const deploymentName = replicaSetName.substring(0, lastDashIndex)
          return deploymentName
        }
      }
    }
    
    // ReplicaSet을 찾지 못했거나 이름 형식이 예상과 다를 경우
    // Pod 이름을 deployment로 사용
    return podItem.metadata?.name || ''
  } catch (error) {
    // 에러 발생 시 Pod 이름 반환
    return podItem.metadata?.name || ''
  }
}
