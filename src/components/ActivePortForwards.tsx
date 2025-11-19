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
  onPortForwardChange?: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => void
  onLocalPortUpdate?: (
    context: string,
    namespace: string,
    podName: string,
    remotePort: number,
    oldLocalPort: number,
    newLocalPort: number
  ) => void
  onContextChange?: (context: string) => void
  onItemClick?: (
    context: string,
    namespace: string,
    podName: string,
    remotePort: number
  ) => void
}

export const ActivePortForwards: React.FC<ActivePortForwardsProps> = ({
  portForwards,
  podsByNamespace,
  activeContext,
  activeLocalPorts,
  onPortForwardChange,
  onLocalPortUpdate,
  onContextChange,
  onItemClick,
}) => {
  const [hoveredItemId, setHoveredItemId] = React.useState<string | null>(null)
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null)
  const [editingPortValue, setEditingPortValue] = React.useState<string>('')
  // 모든 활성 포트포워딩 정보 수집
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

    return items
  }, [portForwards, podsByNamespace])

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
        <span className="active-count">{activePortForwards.length}</span>
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
            <div className="active-port-forward-ports">
              {editingItemId === item.id ? (
                <input
                  type="number"
                  className="active-port-forward-local-port-input"
                  value={editingPortValue}
                  onChange={(e) => setEditingPortValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const newPort = parseInt(editingPortValue, 10)
                      if (!isNaN(newPort) && newPort > 0 && newPort <= 65535) {
                        // 중복 체크 (자신의 기존 포트는 제외)
                        if (activeLocalPorts && activeLocalPorts.has(newPort) && newPort !== item.localPort) {
                          alert(`Port ${newPort} is already in use`)
                          setEditingPortValue(item.localPort.toString())
                          setEditingItemId(null)
                          return
                        }
                        if (onLocalPortUpdate) {
                          onLocalPortUpdate(
                            item.context,
                            item.namespace,
                            item.pod,
                            item.remotePort,
                            item.localPort,
                            newPort
                          )
                        }
                        setEditingItemId(null)
                      } else {
                        alert('Please enter a valid port number (1-65535)')
                        setEditingPortValue(item.localPort.toString())
                        setEditingItemId(null)
                      }
                    } else if (e.key === 'Escape') {
                      setEditingPortValue(item.localPort.toString())
                      setEditingItemId(null)
                    }
                  }}
                  onBlur={() => {
                    const newPort = parseInt(editingPortValue, 10)
                    if (!isNaN(newPort) && newPort > 0 && newPort <= 65535) {
                      // 중복 체크 (자신의 기존 포트는 제외)
                      if (activeLocalPorts && activeLocalPorts.has(newPort) && newPort !== item.localPort) {
                        alert(`Port ${newPort} is already in use`)
                        setEditingPortValue(item.localPort.toString())
                        setEditingItemId(null)
                        return
                      }
                      if (onLocalPortUpdate && newPort !== item.localPort) {
                        onLocalPortUpdate(
                          item.context,
                          item.namespace,
                          item.pod,
                          item.remotePort,
                          item.localPort,
                          newPort
                        )
                      }
                    } else {
                      setEditingPortValue(item.localPort.toString())
                    }
                    setEditingItemId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  min="1"
                  max="65535"
                />
              ) : (
                <span
                  className="active-port-forward-local-port"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingItemId(item.id)
                    setEditingPortValue(item.localPort.toString())
                  }}
                  style={{ cursor: 'pointer' }}
                  title="Click to edit port"
                >
                  {item.localPort}
                </span>
              )}
              <span className="active-port-forward-arrow">→</span>
              <span className="active-port-forward-remote-port">{item.remotePort}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

