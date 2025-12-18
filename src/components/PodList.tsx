import React, { useMemo, useState } from 'react'
import type { Pod, PortForwardConfig, Service } from '@/types'
import { generateServiceUrl } from '@/utils/domain'
import { isHttpServicePort, findMatchingPods } from '@/utils/service'
import { findLatestPod } from '@/utils/pod'
import './PodList.css'

interface ServiceWithContext extends Service {
  context?: string
}

interface PodListProps {
  pods: Pod[]
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
  services?: ServiceWithContext[]
  onPortForwardChange: (
    context: string,
    serviceName: string,
    namespace: string,
    targetPort: number | string,
    enabled: boolean
  ) => void
}

export const PodList: React.FC<PodListProps> = ({
  pods,
  portForwards,
  services = [],
  onPortForwardChange,
}) => {
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  
  // URL 복사 함수
  const handleCopyUrl = async (url: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(`http://${url}`)
      setCopiedUrl(url)
      const timeoutId = setTimeout(() => setCopiedUrl(null), 2000)
      // cleanup은 컴포넌트 언마운트 시 자동으로 처리되지만, 명시적으로 추적 가능하도록 ref 사용 고려 가능
      // 다만 이 경우는 짧은 시간 후 자동으로 null이 되므로 큰 문제는 없음
    } catch (error) {
      console.error('Failed to copy URL:', error)
    }
  }
  
  // Service의 selector로 매칭되는 Pod 찾기 (최신 Pod 선택)
  const findLatestPodForService = (service: Service): Pod | undefined => {
    if (!service.selector) return undefined

    const matchingPods = findMatchingPods(service, pods, true)
    if (matchingPods.length === 0) return undefined

    return findLatestPod(matchingPods)
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

      // 포트포워딩 정보 찾기 (모든 context에서 검색)
      let podPortForwards = new Map<number, PortForwardConfig>()
      let portForwardContext: string | undefined
      const serviceContext = (service as ServiceWithContext).context
      
      if (pod && serviceContext) {
        const contextMap = portForwards.get(serviceContext)
        if (contextMap) {
          const namespaceMap = contextMap.get(service.namespace)
          if (namespaceMap) {
            podPortForwards = namespaceMap.get(pod.name) || new Map()
            // 활성 포트포워딩이 있으면 context 정보 가져오기
            const activePortForward = Array.from(podPortForwards.values()).find(pf => pf.active)
            if (activePortForward) {
              portForwardContext = activePortForward.context
            }
          }
        }
      }
      
      // Service의 context 정보 사용 (포트포워딩 중이면 포트포워딩의 context, 아니면 Service의 context)
      const finalContext = portForwardContext || serviceContext

      list.push({
        service,
        httpPort,
        pod,
        deployment,
        portForwards: podPortForwards,
        context: finalContext,
      })
    }

    // Context, Namespace, Deployment, Pod 이름 기준으로 정렬 (포트포워딩 활성화 여부와 무관)
    return list.sort((a, b) => {
      // Context 비교
      const contextA = a.context || ''
      const contextB = b.context || ''
      if (contextA !== contextB) {
        return contextA.localeCompare(contextB)
      }
      
      // Namespace 비교
      const nsA = a.service.namespace
      const nsB = b.service.namespace
      if (nsA !== nsB) {
        return nsA.localeCompare(nsB)
      }
      
      // Deployment 비교
      const depA = a.deployment || ''
      const depB = b.deployment || ''
      if (depA !== depB) {
        return depA.localeCompare(depB)
      }
      
      // Pod 이름 비교
      const podA = a.pod?.name || ''
      const podB = b.pod?.name || ''
      return podA.localeCompare(podB)
    })
  }, [services, pods, portForwards])

  // Context별로 그룹핑
  const groupedByContext = useMemo(() => {
    const groups = new Map<string, typeof serviceList>()
    for (const item of serviceList) {
      const context = item.context || 'unknown'
      if (!groups.has(context)) {
        groups.set(context, [])
      }
      groups.get(context)!.push(item)
    }
    return groups
  }, [serviceList])

  // 검색 필터링
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) {
      return groupedByContext
    }
    
    const query = searchQuery.toLowerCase()
    const filtered = new Map<string, typeof serviceList>()
    
    for (const [context, items] of groupedByContext.entries()) {
      const matching = items.filter(item => 
        context.toLowerCase().includes(query) ||
        item.service.namespace.toLowerCase().includes(query) ||
        (item.deployment || '').toLowerCase().includes(query) ||
        (item.pod?.name || '').toLowerCase().includes(query) ||
        item.httpPort.port.toString().includes(query)
      )
      
      if (matching.length > 0) {
        filtered.set(context, matching)
      }
    }
    
    return filtered
  }, [groupedByContext, searchQuery])

  // 검색 시 자동 펼치기
  React.useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedContexts(new Set(filteredGroups.keys()))
    }
  }, [searchQuery, filteredGroups])

  // Context 펼치기/접기 토글
  const toggleContext = React.useCallback((context: string) => {
    setExpandedContexts(prev => {
      const next = new Set(prev)
      if (next.has(context)) {
        next.delete(context)
      } else {
        next.add(context)
      }
      return next
    })
  }, [])


  if (serviceList.length === 0) {
    return (
      <div className="pod-list-empty">
        <p>No services</p>
      </div>
    )
  }
  
  // 검색어 하이라이트 함수
  const highlightText = (text: string, query: string): React.ReactNode => {
    if (!query.trim()) {
      return text
    }
    
    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, index) => 
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={index} className="pod-list-search-highlight">{part}</mark>
      ) : (
        part
      )
    )
  }

  return (
    <div className="pod-list">
      <div className="pod-list-search">
        <input
          type="text"
          className="pod-list-search-input"
          placeholder="Search by context, namespace, deployment, pod, port..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="pod-list-search-clear"
            onClick={() => setSearchQuery('')}
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>
      <div className="pod-list-content">
        {filteredGroups.size === 0 ? (
          <div className="pod-list-empty">
            <p>No matching services</p>
          </div>
        ) : (
          <>
            {Array.from(filteredGroups.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([context, items]) => {
              const isExpanded = expandedContexts.has(context)
              
              // Namespace별로 그룹핑
              const namespaceGroups = new Map<string, typeof items>()
              for (const item of items) {
                const namespace = item.service.namespace
                if (!namespaceGroups.has(namespace)) {
                  namespaceGroups.set(namespace, [])
                }
                namespaceGroups.get(namespace)!.push(item)
              }
              
              return (
                <div key={context} className="pod-list-context-group">
                  <div
                    className="pod-list-context-header"
                    onClick={() => toggleContext(context)}
                  >
                    <span className="pod-list-context-icon">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span className="pod-list-context-name">
                      {highlightText(context, searchQuery)}
                    </span>
                    <span className="pod-list-context-count">({items.length})</span>
                  </div>
                  {isExpanded && (
                    <div className="pod-list-context-items">
                      {Array.from(namespaceGroups.entries())
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([namespace, namespaceItems]) => (
                          <div key={namespace} className="pod-list-namespace-group">
                            {namespaceItems.map(({ service, httpPort, pod, deployment, portForwards: podPortForwards, context: serviceContext }) => {
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

                              // URL 생성 (활성 포트포워딩이 있으면 그 domain 사용, 없으면 생성)
                              const serviceUrl = portForwardConfig?.domain 
                                ? portForwardConfig.domain 
                                : generateServiceUrl(service.name, service.namespace, servicePort)

          return (
                                <div 
                                  key={`${service.namespace}:${service.name}:${httpPort.port}`}
                                  className={`pod-list-row ${hasActivePortForward ? 'has-port-forward' : ''} ${!pod ? 'no-pod' : ''}`}
                                  onClick={() => {
                                    // Pod가 없어도 포트포워딩 시도 (handlePortForwardChange에서 처리)
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
                                      // 활성화 (Service의 context 사용)
                                      if (!serviceContext) {
                                        alert('No context available')
                                        return
                                      }
                                      // Pod가 없어도 시도
                                      onPortForwardChange(
                                        serviceContext,
                                        service.name,
                                        service.namespace,
                                        httpPort.targetPort,
                                        true
                                      )
                                    }
                                  }}
                                >
                                  <div className="pod-list-row-content">
                                    <span className="pod-list-info-line">
                                      <span className="pod-list-context">{highlightText(serviceContext || '-', searchQuery)}</span>
                                      <span className="pod-list-separator">|</span>
                                      <span className="pod-list-namespace">{highlightText(service.namespace, searchQuery)}</span>
                                      <span className="pod-list-separator">|</span>
                                      <span className="pod-list-deployment">{highlightText(deployment, searchQuery)}</span>
                                      <span className="pod-list-separator">|</span>
                                      <span className="pod-list-url">{highlightText(serviceUrl, searchQuery)}</span>
                                      <button
                                        className={`pod-list-copy-button ${copiedUrl === serviceUrl ? 'copied' : ''}`}
                                        onClick={(e) => handleCopyUrl(serviceUrl, e)}
                                        title={copiedUrl === serviceUrl ? 'Copied!' : 'Copy URL'}
                                      >
                                        {copiedUrl === serviceUrl ? '✓' : '📋'}
                                      </button>
                </span>
              </div>
            </div>
          )
                            })}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )
              })}
          </>
        )}
      </div>
    </div>
  )
}
