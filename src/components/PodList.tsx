import React, { useMemo } from 'react'
import type { Pod, PortForwardConfig, Service } from '@/types'
import './PodList.css'

interface PodListProps {
  pods: Pod[]
  portForwards: Map<string, Map<number, PortForwardConfig>>
  activeContext?: string | null
  services?: Service[]
  selectedPods: Set<string>
  expandedDeployments: Set<string>
  onPortForwardChange: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => void
  onPodSelect: (podName: string, selected: boolean) => void
  onDeploymentToggle: (deployment: string) => void
}

// HTTP 프로토콜 판단 헬퍼 함수
const isHttpPort = (servicePort: { name?: string }, podPort: { name?: string; containerPort: number }): boolean => {
  // Service 포트 이름에 "http"가 포함되어 있는지 확인 (대소문자 무시)
  if (servicePort.name && servicePort.name.toLowerCase().includes('http')) {
    return true
  }
  // Pod 포트 이름에 "http"가 포함되어 있는지 확인
  if (podPort.name && podPort.name.toLowerCase().includes('http')) {
    return true
  }
  return false
}

export const PodList: React.FC<PodListProps> = ({
  pods,
  portForwards,
  services = [],
  selectedPods,
  expandedDeployments,
  onPortForwardChange,
  onPodSelect,
  onDeploymentToggle,
}) => {
  // Pod와 Service 매칭을 위한 맵 생성
  const podServiceMap = useMemo(() => {
    const map = new Map<string, Service>()
    for (const service of services) {
      if (service.selector) {
        for (const pod of pods) {
          if (!pod.labels) continue
          let matches = true
          for (const [key, value] of Object.entries(service.selector)) {
            if (pod.labels[key] !== value) {
              matches = false
              break
            }
          }
          if (matches && !map.has(pod.name)) {
            map.set(pod.name, service)
          }
        }
      }
    }
    return map
  }, [pods, services])

  // HTTP 포트만 필터링된 Pod 목록
  const httpPods = useMemo(() => {
    return pods.filter(pod => {
      // FAILED 상태는 제외
      if (pod.status.toLowerCase() === 'failed') {
        return false
      }
      
      // HTTP 포트가 있는지 확인
      const service = podServiceMap.get(pod.name)
      for (const podPort of pod.ports) {
        let isHttp = false
        
        if (service) {
          // Service의 포트 중 Pod 포트와 매칭되는 것 찾기
          for (const servicePort of service.ports) {
            const targetPort = servicePort.targetPort
            let matches = false
            
            if (typeof targetPort === 'number') {
              matches = targetPort === podPort.containerPort
            } else {
              matches = targetPort === podPort.name
            }
            
            if (matches) {
              isHttp = isHttpPort(servicePort, podPort)
              break
            }
          }
        } else {
          // Service가 없으면 Pod 포트 이름만 확인
          isHttp = podPort.name ? podPort.name.toLowerCase().includes('http') : false
        }
        
        if (isHttp) {
          return true
        }
      }
      
      return false
    })
  }, [pods, podServiceMap])

  // Deployment 단위로 그룹화
  const deploymentsMap = useMemo(() => {
    const map = new Map<string, Pod[]>()
    for (const pod of httpPods) {
      const deployment = pod.deployment || pod.name
      if (!map.has(deployment)) {
        map.set(deployment, [])
      }
      map.get(deployment)!.push(pod)
    }
    return map
  }, [httpPods])

  if (httpPods.length === 0) {
    return (
      <div className="pod-list-empty">
        <p>No HTTP pods</p>
      </div>
    )
  }

  // Deployment 목록을 정렬
  const sortedDeployments = Array.from(deploymentsMap.entries()).sort((a, b) => {
    return a[0].localeCompare(b[0])
  })

  return (
    <div className="pod-list">
      {sortedDeployments.map(([deployment, deploymentPods]) => {
        const isExpanded = expandedDeployments.has(deployment)
        const sortedPods = [...deploymentPods].sort((a, b) => a.name.localeCompare(b.name))
        
        return (
          <div key={deployment} className="deployment-group">
            <div 
              className="deployment-header"
              onClick={() => onDeploymentToggle(deployment)}
            >
              <span className="deployment-expand-icon">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="deployment-name">{deployment}</span>
              <span className="deployment-pod-count">({sortedPods.length})</span>
            </div>
            
            {isExpanded && (
              <div className="deployment-pods">
                {sortedPods.map((pod) => {
                  const isSelected = selectedPods.has(pod.name)
                  const podPortForwards = portForwards.get(pod.name) || new Map()
                  
                  // HTTP 포트만 필터링
                  const httpPorts = pod.ports.filter(podPort => {
                    const service = podServiceMap.get(pod.name)
                    if (service) {
                      for (const servicePort of service.ports) {
                        const targetPort = servicePort.targetPort
                        let matches = false
                        
                        if (typeof targetPort === 'number') {
                          matches = targetPort === podPort.containerPort
                        } else {
                          matches = targetPort === podPort.name
                        }
                        
                        if (matches) {
                          return isHttpPort(servicePort, podPort)
                        }
                      }
                    } else {
                      return podPort.name ? podPort.name.toLowerCase().includes('http') : false
                    }
                    return false
                  })
                  
                  return (
                    <div key={pod.name} className="pod-item">
                      <div className="pod-item-header">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => onPodSelect(pod.name, e.target.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="pod-name">{pod.name}</span>
                        <span className={`pod-status pod-status-${pod.status.toLowerCase()}`}>
                          {pod.status}
                        </span>
                      </div>
                      {httpPorts.map((port) => {
                        const portForward = podPortForwards.get(port.containerPort) || null
                        return (
                          <div 
                            key={`${pod.name}-${port.containerPort}`}
                            className={`port-item ${portForward?.active ? 'port-active' : ''}`}
                            onClick={() => {
                              if (portForward?.active) {
                                onPortForwardChange(pod.name, port.containerPort, portForward.localPort, false)
                              } else {
                                onPortForwardChange(pod.name, port.containerPort, port.containerPort, true)
                              }
                            }}
                          >
                            <span className="port-name">{port.name || 'http'}</span>
                            <span className="port-number">{port.containerPort}</span>
                            {portForward?.domain && (
                              <span className="port-domain">🌐 {portForward.domain}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
