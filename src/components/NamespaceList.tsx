import React, { useState } from 'react'
import type { Namespace } from '@/types'
import './NamespaceList.css'

interface NamespaceListProps {
  namespaces: Namespace[]
  visibleNamespaces: Set<string>
  onToggleNamespace: (namespace: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onSelectOnly: (namespace: string) => void
}

// 시스템 namespace 목록 (제외 대상)
const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease']

export const NamespaceList: React.FC<NamespaceListProps> = ({
  namespaces,
  visibleNamespaces,
  onToggleNamespace,
  onSelectAll,
  onDeselectAll,
  onSelectOnly,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  // 시스템 namespace 제외하고 필터링
  const filteredNamespaces = namespaces.filter(ns => !SYSTEM_NAMESPACES.includes(ns.name))
  const allSelected = filteredNamespaces.length > 0 && filteredNamespaces.every(ns => visibleNamespaces.has(ns.name))
  const someSelected = filteredNamespaces.some(ns => visibleNamespaces.has(ns.name))

  return (
    <div className={`namespace-list ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="namespace-list-header">
        <h2>namespace</h2>
        <div className="namespace-header-right">
          <span className="namespace-count">{filteredNamespaces.length}</span>
          <button
            className="namespace-collapse-button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            <span className={`collapse-icon ${isExpanded ? 'expanded' : 'collapsed'}`}>▼</span>
          </button>
        </div>
      </div>
      {isExpanded && (
        <>
          <div className="namespace-controls">
            <button 
              className="namespace-control-button"
              onClick={onSelectAll}
              title="Select All"
            >
              all
            </button>
            <button 
              className="namespace-control-button"
              onClick={onDeselectAll}
              title="Deselect All"
            >
              clear
            </button>
          </div>
          <div className="namespace-list-content">
        {filteredNamespaces.length === 0 ? (
          <div className="empty-state">No namespaces</div>
        ) : (
          // 시스템 namespace 제외하고 알파벳 순으로 정렬
          [...filteredNamespaces]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((namespace) => {
              const isVisible = visibleNamespaces.has(namespace.name)
              return (
                <div key={namespace.name} className="namespace-item">
                  <button
                    className={`namespace-toggle-button ${isVisible ? 'active' : ''}`}
                    onClick={() => onToggleNamespace(namespace.name)}
                  >
                    <span className="namespace-name">{namespace.name}</span>
                  </button>
                  <button
                    className="namespace-only-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectOnly(namespace.name)
                    }}
                    title={`View ${namespace.name} only`}
                  >
                    Only
                  </button>
                </div>
              )
            })
        )}
          </div>
        </>
      )}
    </div>
  )
}

