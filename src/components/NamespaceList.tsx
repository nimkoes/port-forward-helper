import React, { useState } from 'react'
import type { Namespace } from '@/types'
import { getAllowedNamespaces } from '@/utils/config'
import './NamespaceList.css'

interface NamespaceListProps {
  namespaces: Namespace[]
  visibleNamespaces: Set<string>
  onToggleNamespace: (namespace: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onSelectOnly: (namespace: string) => void
}

// 표시할 네임스페이스 목록 (환경 변수에서 읽어옴)
const ALLOWED_NAMESPACES = getAllowedNamespaces()

export const NamespaceList: React.FC<NamespaceListProps> = ({
  namespaces,
  visibleNamespaces,
  onToggleNamespace,
  onSelectAll,
  onDeselectAll,
  onSelectOnly,
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const allowedNamespaces = namespaces.filter(ns => ALLOWED_NAMESPACES.has(ns.name))
  const allSelected = allowedNamespaces.length > 0 && allowedNamespaces.every(ns => visibleNamespaces.has(ns.name))
  const someSelected = allowedNamespaces.some(ns => visibleNamespaces.has(ns.name))

  return (
    <div className={`namespace-list ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="namespace-list-header">
        <h2>네임스페이스</h2>
        <div className="namespace-header-right">
          <span className="namespace-count">{allowedNamespaces.length}</span>
          <button
            className="namespace-collapse-button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? '접기' : '펼치기'}
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
              title="전부 선택"
            >
              전체
            </button>
            <button 
              className="namespace-control-button"
              onClick={onDeselectAll}
              title="전부 해제"
            >
              해제
            </button>
          </div>
          <div className="namespace-list-content">
        {namespaces.length === 0 ? (
          <div className="empty-state">네임스페이스가 없습니다</div>
        ) : (
          // 허용된 네임스페이스만 필터링하고 알파벳 순으로 정렬
          [...namespaces]
            .filter(namespace => ALLOWED_NAMESPACES.has(namespace.name))
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
                    title={`${namespace.name}만 보기`}
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

