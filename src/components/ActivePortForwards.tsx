import React from 'react'
import type { PortForwardConfig, Pod } from '@/types'
import './ActivePortForwards.css'

interface ActivePortForwardItem extends PortForwardConfig {
  protocol: string
}

interface ActivePortForwardsProps {
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
  podsByNamespace: Map<string, Pod[]>
  activeContext?: string | null
  activeLocalPorts?: Set<number>
  selectedPods?: Set<string>
  onPortForwardChange?: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => void
  onContextChange?: (context: string) => void
  onItemClick?: (
    context: string,
    namespace: string,
    podName: string,
    remotePort: number
  ) => void
  onDisableAll?: () => void
}

export const ActivePortForwards: React.FC<ActivePortForwardsProps> = ({
  portForwards,
  podsByNamespace,
  activeContext,
  activeLocalPorts,
  selectedPods,
  onPortForwardChange,
  onContextChange,
  onItemClick,
  onDisableAll,
}) => {
  const [hoveredItemId, setHoveredItemId] = React.useState<string | null>(null)
  const [copiedDomainId, setCopiedDomainId] = React.useState<string | null>(null)
  // 선택한 Pod의 활성 포트포워딩 정보 수집
  const activePortForwards = React.useMemo<ActivePortForwardItem[]>(() => {
    const items: ActivePortForwardItem[] = []

    // 모든 컨텍스트 순회
    for (const [context, contextMap] of portForwards.entries()) {
      // 모든 네임스페이스 순회
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        // Pod 정보 가져오기 (프로토콜 정보를 위해)
        const pods = podsByNamespace.get(namespace) || []
        const podInfoMap = new Map<string, Pod>()
        pods.forEach(pod => podInfoMap.set(pod.name, pod))

        // 모든 Pod 순회
        for (const [podName, podPortMap] of namespaceMap.entries()) {
          // 선택한 Pod만 표시 (selectedPods가 없으면 모든 Pod 표시)
          if (selectedPods && selectedPods.size > 0 && !selectedPods.has(podName)) {
            continue
          }
          
          // 모든 포트포워딩 순회
          for (const [remotePort, config] of podPortMap.entries()) {
            if (config.active) {
              // Pod에서 프로토콜 정보 찾기
              const pod = podInfoMap.get(podName)
              const port = pod?.ports.find(p => p.containerPort === remotePort)
              const protocol = port?.protocol || 'TCP'

              items.push({
                ...config,
                protocol,
              })
            }
          }
        }
      }
    }

    return items.sort((a, b) => a.localPort - b.localPort)
  }, [portForwards, podsByNamespace, selectedPods])

  if (activePortForwards.length === 0) {
    return (
      <div className="active-port-forwards">
        <div className="active-port-forwards-header">
          <h2>Active Port Forward</h2>
          <span className="active-count">0</span>
        </div>
        <div className="active-port-forwards-empty">
          <p>No active port forwards</p>
        </div>
      </div>
    )
  }

  return (
    <div className="active-port-forwards">
      <div className="active-port-forwards-header">
        <h2>Active Port Forward</h2>
        <div className="active-port-forwards-header-right">
          {onDisableAll && (
            <button
              className="active-port-forwards-disable-all-button"
              onClick={onDisableAll}
              title="Disable all port forwards"
            >
              Disable All
            </button>
          )}
          <span className="active-count">{activePortForwards.length}</span>
        </div>
      </div>
      <div className="active-port-forwards-content">
        {activePortForwards.map((item) => (
          <div
            key={item.id}
            className="active-port-forward-item"
            onMouseEnter={() => setHoveredItemId(item.id)}
            onMouseLeave={() => setHoveredItemId(null)}
            onClick={() => {
              if (onItemClick) {
                onItemClick(item.context, item.namespace, item.pod, item.remotePort)
              }
            }}
            style={{ cursor: onItemClick ? 'pointer' : 'default' }}
          >
            {hoveredItemId === item.id && onPortForwardChange && (
              <button
                className="active-port-forward-close-button"
                onClick={async (e) => {
                  e.stopPropagation()
                  // 다른 컨텍스트의 포트포워딩인 경우 컨텍스트 전환
                  if (activeContext !== item.context && onContextChange) {
                    onContextChange(item.context)
                    // 컨텍스트 전환 후 약간 대기
                    await new Promise(resolve => setTimeout(resolve, 100))
                  }
                  onPortForwardChange(item.pod, item.remotePort, item.localPort, false)
                }}
                title="Disable Port Forward"
              >
                ×
              </button>
            )}
            <div className="active-port-forward-tags">
              <span className="active-port-forward-tag">{item.protocol}</span>
              <span className="active-port-forward-tag">{item.context}</span>
              <span className="active-port-forward-tag">{item.namespace}</span>
            </div>
            <div className="active-port-forward-pod">
              {item.pod}
            </div>
            {item.domain && (
              <div className="active-port-forward-domain-container">
                <div className="active-port-forward-domain" title={`http://${item.domain}`}>
                  🌐 {item.domain}
                </div>
                <button
                  className="active-port-forward-copy-button"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const url = `http://${item.domain}`
                    try {
                      await navigator.clipboard.writeText(url)
                      setCopiedDomainId(item.id)
                      setTimeout(() => {
                        setCopiedDomainId(null)
                      }, 2000)
                    } catch (err) {
                      console.error('Failed to copy domain:', err)
                    }
                  }}
                  title="Copy domain to clipboard"
                >
                  {copiedDomainId === item.id ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
