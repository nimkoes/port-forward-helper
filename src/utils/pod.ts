import type { Pod } from '@/types'

/**
 * Pod의 metadata에서 Deployment 이름을 추출합니다.
 * ownerReferences를 통해 ReplicaSet을 찾고, ReplicaSet의 이름에서 Deployment 이름을 추출합니다.
 * Deployment를 찾지 못하면 Pod 이름을 반환합니다.
 * 
 * @param podItem Kubernetes Pod 객체
 * @returns Deployment 이름 또는 Pod 이름
 */
export function extractDeploymentName(podItem: any): string {
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

/**
 * Pod 목록에서 creationTimestamp 기준으로 최신 Pod를 선택합니다.
 * @param pods Pod 목록
 * @returns 최신 Pod 또는 undefined
 */
export function findLatestPod(pods: Pod[]): Pod | undefined {
  if (pods.length === 0) return undefined

  const sortedPods = [...pods].sort((a, b) => {
    const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
    const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
    return bTime - aTime // 최신이 먼저
  })

  return sortedPods[0]
}

