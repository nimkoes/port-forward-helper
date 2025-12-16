import React, { useState, useRef, useEffect } from 'react'
import './GlobalNavBar.css'

interface GlobalNavBarProps {
  activeContext: string | null
  onClearAllCache: () => void
  onClearNamespaceCache: () => void
  onClearServiceCache: () => void
  onClearPodCache: () => void
  onRefresh: () => void
  refreshing: boolean
}

export const GlobalNavBar: React.FC<GlobalNavBarProps> = ({
  activeContext,
  onClearAllCache,
  onClearNamespaceCache,
  onClearServiceCache,
  onClearPodCache,
  onRefresh,
  refreshing,
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
        {activeContext && (
          <span className="gnb-context">
            <span className="gnb-context-label">Context:</span>
            <span className="gnb-context-value">{activeContext}</span>
          </span>
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
      </div>
    </div>
  )
}

