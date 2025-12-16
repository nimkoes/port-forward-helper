import React, { useMemo, useState } from 'react'
import type { Pod, PortForwardConfig, Service } from '@/types'
import { generateServiceUrl } from '@/utils/domain'
import './PodList.css'

interface ServiceWithContext extends Service {
  context?: string
}

interface PodListProps {
  pods: Pod[]
  portForwards: Map<string, Map<number, PortForwardConfig>>
  activeContext?: string | null
  services?: ServiceWithContext[]
  onPortForwardChange: (
    context: string,
    serviceName: string,
    namespace: string,
    targetPort: number | string,
    enabled: boolean
  ) => void
}

// Service 포트가 HTTP인지 확인하는 함수
const isHttpServicePort = (servicePort: Service['ports'][0]): boolean => {
  // grpc 포트는 제외
  if (servicePort.name && servicePort.name.toLowerCase().includes('grpc')) {
    return false
  }
  // Service 포트 이름에 "http"가 포함되어 있는지 확인 (대소문자 무시)
  if (servicePort.name && servicePort.name.toLowerCase().includes('http')) {
    return true
  }
  // 포트 이름이 없거나 "http"가 포함되지 않았지만, 포트 번호가 80이면 HTTP로 간주
  if (servicePort.port === 80) {
    return true
  }
  return false
}

export const PodList: React.FC<PodListProps> = ({
  pods,
  portForwards,
  activeContext,
  services = [],
  onPortForwardChange,
}) => {
  // Service의 selector로 매칭되는 Pod 찾기 (최신 Pod 선택)
  const findLatestPodForService = (service: Service): Pod | undefined => {
    if (!service.selector) return undefined

    const matchingPods: Pod[] = []
    for (const pod of pods) {
      if (!pod.labels) continue
      
      let matches = true
      for (const [key, value] of Object.entries(service.selector)) {
        if (pod.labels[key] !== value) {
          matches = false
          break
        }
      }
      
      if (matches && pod.status.toLowerCase() !== 'failed') {
        matchingPods.push(pod)
      }
    }

    if (matchingPods.length === 0) return undefined

    // 최신 Pod 선택 (creationTimestamp 기준)
    const sortedPods = [...matchingPods].sort((a, b) => {
      const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
      const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
      return bTime - aTime // 최신이 먼저
    })

    return sortedPods[0]
  }

  // Service의 selector로 매칭되는 Pod 개수 계산
  const getPodCountForService = (service: Service): number => {
    if (!service.selector) return 0

    let count = 0
    for (const pod of pods) {
      if (!pod.labels) continue
      
      let matches = true
      for (const [key, value] of Object.entries(service.selector)) {
        if (pod.labels[key] !== value) {
          matches = false
          break
        }
      }
      
      if (matches && pod.status.toLowerCase() !== 'failed') {
        count++
      }
    }

    return count
  }

  // Service의 selector로 매칭되는 Pod 이름 목록 반환
  const getPodNamesForService = (service: Service): string[] => {
    if (!service.selector) return []

    const podNames: string[] = []
    for (const pod of pods) {
      if (!pod.labels) continue
      
      let matches = true
      for (const [key, value] of Object.entries(service.selector)) {
        if (pod.labels[key] !== value) {
          matches = false
          break
        }
      }
      
      if (matches && pod.status.toLowerCase() !== 'failed') {
        podNames.push(pod.name)
      }
    }

    return podNames.sort()
  }

  // Service 목록 생성 (ClusterIP 타입이고 http 포트가 있는 것만)
  const serviceList = useMemo(() => {
    const list: Array<{
      service: Service
      httpPort: Service['ports'][0]
      pod?: Pod
      deployment?: string
      portForwards: Map<number, PortForwardConfig>
      context?: string // 포트포워딩 중인 경우 context 정보
    }> = []

    for (const service of services) {
      // ClusterIP 타입만 허용
      if (service.type !== 'ClusterIP') {
        continue
      }

      // HTTP 포트 찾기
      const httpPort = service.ports.find(isHttpServicePort)
      if (!httpPort) {
        continue
      }

      // Service의 selector로 Pod 찾기
      const pod = findLatestPodForService(service)
      const deployment = pod?.deployment || service.name

      // 포트포워딩 정보 찾기 (Pod 이름을 키로, Pod가 없으면 Service 이름으로 찾기)
      let podPortForwards = new Map<number, PortForwardConfig>()
      let portForwardContext: string | undefined
      if (pod) {
        podPortForwards = portForwards.get(pod.name) || new Map()
        // 활성 포트포워딩이 있으면 context 정보 가져오기
        const activePortForward = Array.from(podPortForwards.values()).find(pf => pf.active)
        if (activePortForward) {
          portForwardContext = activePortForward.context
        }
      } else {
        // Pod가 없어도 포트포워딩 정보가 있을 수 있음 (이전에 포트포워딩했던 경우)
        // Service 이름으로 매칭되는 Pod를 찾아서 포트포워딩 정보 가져오기
        for (const [podName, podMap] of portForwards.entries()) {
          const podInfo = pods.find(p => p.name === podName && p.namespace === service.namespace)
          if (podInfo && service.selector) {
            let matches = true
            if (podInfo.labels) {
              for (const [key, value] of Object.entries(service.selector)) {
                if (podInfo.labels[key] !== value) {
                  matches = false
                  break
                }
              }
              if (matches) {
                podPortForwards = podMap
                // 활성 포트포워딩이 있으면 context 정보 가져오기
                const activePortForward = Array.from(podMap.values()).find(pf => pf.active)
                if (activePortForward) {
                  portForwardContext = activePortForward.context
                }
                break
              }
            }
          }
        }
      }

      // Service의 context 정보 사용 (포트포워딩 중이면 포트포워딩의 context, 아니면 Service의 context)
      const serviceContext = portForwardContext || (service as ServiceWithContext).context || activeContext || undefined

      list.push({
        service,
        httpPort,
        pod,
        deployment,
        portForwards: podPortForwards,
        context: serviceContext,
      })
    }

    // 포트포워딩이 활성화된 항목을 최상단으로 정렬
    return list.sort((a, b) => {
      const aHasActive = Array.from(a.portForwards.values()).some(pf => pf.active)
      const bHasActive = Array.from(b.portForwards.values()).some(pf => pf.active)
      
      // 둘 다 활성화되어 있거나 둘 다 비활성화되어 있으면 이름순 정렬
      if (aHasActive === bHasActive) {
        return a.service.name.localeCompare(b.service.name)
      }
      
      // 활성화된 항목이 먼저 오도록
      return aHasActive ? -1 : 1
    })
  }, [services, pods, portForwards])

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [tooltipPodNames, setTooltipPodNames] = useState<{serviceKey: string, podNames: string[], x: number, y: number} | null>(null)

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl(null), 2000)
    } catch (error) {
      console.error('Failed to copy URL:', error)
    }
  }

  if (serviceList.length === 0) {
    return (
      <div className="pod-list-empty">
        <p>No services</p>
      </div>
    )
  }

  return (
    <div className="pod-list">
      {serviceList.map(({ service, httpPort, pod, deployment, portForwards: podPortForwards, context: serviceContext }) => {
        // targetPort를 숫자로 변환 (포트포워딩용 - Pod 포트)
        const targetPort = typeof httpPort.targetPort === 'number' 
          ? httpPort.targetPort 
          : (pod?.ports.find(p => p.name === httpPort.targetPort)?.containerPort || 0)

        // Service Port (표시 및 URL 생성용)
        const servicePort = httpPort.port

        // 활성 포트포워딩 찾기 (targetPort로 매칭 - Pod 포트)
        const activePortForward = Array.from(podPortForwards.entries())
          .find(([port, pf]) => pf.active && port === targetPort)

        const hasActivePortForward = !!activePortForward
        const portForwardConfig = activePortForward?.[1]

        // URL 생성 (Service Port 사용)
        const serviceUrl = generateServiceUrl(service.name, service.namespace, servicePort)

        return (
          <div 
            key={`${service.namespace}:${service.name}:${httpPort.port}`}
            className={`pod-list-row ${hasActivePortForward ? 'has-port-forward' : ''} ${!pod ? 'no-pod' : ''}`}
            onClick={() => {
              if (!pod) {
                alert('No matching Pod found for this Service')
                return
              }

              if (hasActivePortForward && portForwardConfig) {
                // 비활성화 (포트포워딩 config의 context 사용)
                onPortForwardChange(
                  portForwardConfig.context,
                  service.name,
                  service.namespace,
                  httpPort.targetPort,
                  false
                )
              } else {
                // 활성화 (현재 activeContext 사용)
                if (!activeContext) {
                  alert('No active context')
                  return
                }
                onPortForwardChange(
                  activeContext,
                  service.name,
                  service.namespace,
                  httpPort.targetPort,
                  true
                )
              }
            }}
            title={!pod ? 'No matching Pod found' : ''}
          >
            <div className="pod-list-row-content">
              {hasActivePortForward && portForwardConfig && pod ? (
                <>
                  {/* 활성 상태: 첫 번째 줄 */}
                  <div className="pod-list-row-line">
                    <span className="pod-list-info-line">
                      <span className="pod-list-context">{portForwardConfig.context}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-namespace">{service.namespace}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-deployment">{deployment}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-port-forward-chain">
                        <span className="pod-list-port-label">Loc:</span>
                        <span className="pod-list-port-value">{portForwardConfig.localPort}</span>
                        <span className="pod-list-arrow">→</span>
                        <span className="pod-list-port-label">Pod:</span>
                        <span className="pod-list-port-value">{targetPort}</span>
                        <span className="pod-list-arrow">→</span>
                        <span className="pod-list-port-label">Svc:</span>
                        <span className="pod-list-port-value">{httpPort.port}</span>
                      </span>
                    </span>
                  </div>
                  {/* 활성 상태: 두 번째 줄 */}
                  <div className="pod-list-row-line">
                    <span className="pod-list-info-line">
                      <span className="pod-list-pod-name-label">Pod:</span>
                      <span className="pod-list-pod-name">{pod.name}</span>
                      <span className="pod-list-separator">|</span>
                      <span className={`pod-list-status pod-list-status-${pod.status.toLowerCase()}`}>
                        {pod.status}
                      </span>
                      {portForwardConfig.domain && (
                        <>
                          <span className="pod-list-separator">|</span>
                          <span className="pod-list-url-text">{portForwardConfig.domain}</span>
                          <button
                            className="pod-list-url-copy-button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const url = `http://${portForwardConfig.domain}`
                              handleCopyUrl(url)
                            }}
                            title="Copy URL"
                          >
                            {copiedUrl === `http://${portForwardConfig.domain}` ? '✓' : '📋'}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {/* 비활성 상태: 첫 번째 줄 */}
                  <div className="pod-list-row-line">
                    <span className="pod-list-info-line">
                      <span className="pod-list-context">{serviceContext || '-'}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-namespace">{service.namespace}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-deployment">{deployment}</span>
                      <span className="pod-list-separator">|</span>
                      <span className="pod-list-service-name">{service.name}</span>
                      <span className="pod-list-separator">:</span>
                      <span className="pod-list-target-port">{servicePort}</span>
                    </span>
                  </div>
                  {/* 비활성 상태: 두 번째 줄 */}
                  <div className="pod-list-row-line">
                    <span className="pod-list-info-line">
                      <span className="pod-list-pod-count-label">Pod count:</span>
                      <span 
                        className="pod-list-pod-count"
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation()
                        }}
                        onMouseEnter={(e) => {
                          e.stopPropagation()
                          const podNames = getPodNamesForService(service)
                          if (podNames.length > 0) {
                            const serviceKey = `${service.namespace}:${service.name}:${httpPort.port}`
                            setTooltipPodNames({ 
                              serviceKey, 
                              podNames,
                              x: e.clientX,
                              y: e.clientY
                            })
                          }
                        }}
                        onMouseMove={(e) => {
                          if (tooltipPodNames?.serviceKey === `${service.namespace}:${service.name}:${httpPort.port}`) {
                            setTooltipPodNames(prev => prev ? {
                              ...prev,
                              x: e.clientX,
                              y: e.clientY
                            } : null)
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation()
                          setTooltipPodNames(null)
                        }}
                      >
                        {getPodCountForService(service)}
                      </span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
      {tooltipPodNames && (
        <div 
          className="pod-count-tooltip"
          style={{
            left: `${tooltipPodNames.x + 10}px`,
            top: `${tooltipPodNames.y + 10}px`,
          }}
        >
          {tooltipPodNames.podNames.map((name, idx) => (
            <span key={idx} className="pod-name-item">{name}</span>
          ))}
        </div>
      )}
    </div>
  )
}
