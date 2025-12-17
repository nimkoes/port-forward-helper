import React, { useState, useRef, useEffect } from 'react'
import type { KubernetesContext, PortForwardConfig } from '@/types'
import './GlobalNavBar.css'

interface GlobalNavBarProps {
  activeContext: string | null
  onClearAllCache: () => void
  onClearNamespaceCache: () => void
  onClearServiceCache: () => void
  onClearPodCache: () => void
  onRefresh: () => void
  refreshing: boolean
  contexts: KubernetesContext[]
  onAllForward: (context: string) => void
  allForwarding: Set<string>
  allForwardProgress: Map<string, { current: number; total: number }>
  onDisableAllPortForwards: () => void
  onContextToggle: (context: string) => void
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
}

export const GlobalNavBar: React.FC<GlobalNavBarProps> = ({
  activeContext,
  onClearAllCache,
  onClearNamespaceCache,
  onClearServiceCache,
  onClearPodCache,
  onRefresh,
  refreshing,
  contexts,
  onAllForward,
  allForwarding,
  allForwardProgress,
  onDisableAllPortForwards,
  onContextToggle,
  portForwards,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  const handleClearCacheClick = (type: 'all' | 'namespace' | 'service' | 'pod') => {
    switch (type) {
      case 'all':
        onClearAllCache()
        break
      case 'namespace':
        onClearNamespaceCache()
        break
      case 'service':
        onClearServiceCache()
        break
      case 'pod':
        onClearPodCache()
        break
    }
    setDropdownOpen(false)
  }

  return (
    <div className="global-nav-bar">
      <div className="gnb-left">
        <span className="gnb-title">Kubernetes Port Forward Helper</span>
        {contexts.length > 0 && (
          <div className="gnb-context-buttons">
            {contexts.map((context) => {
              // 해당 context에 활성 포트포워딩이 있는지 확인
              const contextMap = portForwards.get(context.name)
              let hasActiveForwards = false
              
              if (contextMap) {
                for (const namespaceMap of contextMap.values()) {
                  for (const podMap of namespaceMap.values()) {
                    for (const config of podMap.values()) {
                      if (config.active) {
                        hasActiveForwards = true
                        break
                      }
                    }
                    if (hasActiveForwards) break
                  }
                  if (hasActiveForwards) break
                }
              }

              const isForwarding = allForwarding.has(context.name)
              const progress = allForwardProgress.get(context.name)

              return (
                <button
                  key={context.name}
                  className={`gnb-context-toggle-button ${hasActiveForwards ? 'active' : ''}`}
                  onClick={() => onContextToggle(context.name)}
                  disabled={isForwarding || (allForwarding.size > 0 && !isForwarding)}
                  title={hasActiveForwards ? 'Disable all port forwards for this context' : 'Forward all services in this context'}
                >
                  {context.name}
                  {hasActiveForwards && <span className="active-indicator">●</span>}
                  {isForwarding && (
                    <span className="forwarding-indicator">
                      {progress ? ` (${progress.current}/${progress.total})` : ' (forwarding...)'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="gnb-right">
        <div className="gnb-dropdown-container" ref={dropdownRef}>
          <button
            className="gnb-button gnb-clear-cache-button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Clear cache options"
          >
            Clear Cache
            <span className="gnb-dropdown-arrow">▼</span>
          </button>
          {dropdownOpen && (
            <div className="gnb-dropdown-menu">
              <button
                className="gnb-dropdown-item"
                onClick={() => handleClearCacheClick('all')}
              >
                Clear All Cache
              </button>
              <div className="gnb-dropdown-divider"></div>
              <button
                className="gnb-dropdown-item"
                onClick={() => handleClearCacheClick('namespace')}
              >
                Clear Namespace Cache
              </button>
              <button
                className="gnb-dropdown-item"
                onClick={() => handleClearCacheClick('service')}
              >
                Clear Service Cache
              </button>
              <button
                className="gnb-dropdown-item"
                onClick={() => handleClearCacheClick('pod')}
              >
                Clear Pod Cache
              </button>
            </div>
          )}
        </div>
        <button
          className="gnb-button gnb-refresh-button"
          onClick={onRefresh}
          disabled={refreshing || !activeContext}
          title="Refresh (clear cache and reload data)"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          className="gnb-button gnb-disable-all-button"
          onClick={onDisableAllPortForwards}
          title="Disable all port forwards"
        >
          Disable All
        </button>
      </div>
    </div>
  )
}

