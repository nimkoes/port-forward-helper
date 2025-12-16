import React from 'react'
import type { Pod, PortForwardConfig } from '@/types'
import { PortForwardingRow } from './PortForwardingRow'
import './PodList.css'

interface PodListProps {
  pods: Pod[]
  portForwards: Map<string, Map<number, PortForwardConfig>>
  activeContext?: string | null
  onPortForwardChange: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => void
}

export const PodList: React.FC<PodListProps> = ({
  pods,
  portForwards,
  activeContext,
  onPortForwardChange,
}) => {
  if (pods.length === 0) {
    return (
      <div className="pod-list-empty">
        <p>No pods</p>
      </div>
    )
  }

  // FAILED 상태이거나 포트가 없는 Pod는 필터링
  const validPods = pods.filter(pod => {
    // FAILED 상태는 제외
    if (pod.status.toLowerCase() === 'failed') {
      return false
    }
    // 포트 정보가 없으면 제외
    if (pod.ports.length === 0) {
      return false
    }
    return true
  })
  
  // 모든 Pod를 표시 (선택한 모든 네임스페이스의 Pod)
  // Pod를 네임스페이스별, 이름별로 정렬
  const sortedPods = [...validPods].sort((a, b) => {
    // 먼저 네임스페이스로 정렬
    const nsCompare = a.namespace.localeCompare(b.namespace)
    if (nsCompare !== 0) return nsCompare
    // 같은 네임스페이스 내에서는 이름으로 정렬
    return a.name.localeCompare(b.name)
  })
  
  if (sortedPods.length === 0) {
    return (
      <div className="pod-list-empty">
        <p>No pods</p>
      </div>
    )
  }
  
  // 모든 Pod의 모든 포트를 표시
  return (
    <div className="pod-list">
      {sortedPods.map((pod) => {
        const podPortForwards = portForwards.get(pod.name) || new Map()
        
        // 포트가 없으면 Pod 이름만 표시
        if (pod.ports.length === 0) {
          return (
            <div key={pod.name} className="pod-row-single">
              <div className="pod-row-content">
                <span className="pod-name-inline">{pod.name}</span>
                <span className="pod-namespace-inline">{pod.namespace}</span>
                <span className={`pod-status-inline pod-status-${pod.status.toLowerCase()}`}>
                  {pod.status}
                </span>
                <span className="pod-age-inline">{pod.age}</span>
                <div className="pod-row-empty">No port info</div>
              </div>
            </div>
          )
        }
        
        // 각 포트별로 한 줄씩 표시
        return pod.ports.map((port) => {
          const portForward = podPortForwards.get(port.containerPort) || null
          return (
            <PortForwardingRow
              key={`${pod.name}-${port.containerPort}-${port.protocol}`}
              podName={pod.name}
              podNamespace={pod.namespace}
              podStatus={pod.status}
              podAge={pod.age}
              podDeployment={pod.deployment}
              podContext={activeContext || undefined}
              port={port}
              portForward={portForward}
              onPortForwardChange={onPortForwardChange}
            />
          )
        })
      })}
    </div>
  )
}

