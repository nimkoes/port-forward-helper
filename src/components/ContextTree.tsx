import React, { useState, useMemo } from 'react'
import type { KubernetesContext, Namespace, PortForwardConfig } from '@/types'
import './ContextTree.css'

interface ContextTreeProps {
  contexts: KubernetesContext[]
  namespacesByContext: Map<string, Namespace[]>
  visibleNamespacesByContext: Map<string, Set<string>>
  expandedContexts: Set<string>
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
  onToggleContext: (context: string) => void
  onToggleNamespace: (context: string, namespace: string) => void
  onSelectAllNamespaces: (context: string) => void
  onDeselectAllNamespaces: (context: string) => void
  onSelectOnlyNamespace: (context: string, namespace: string) => void
  onRefresh: (context: string) => void
  onAllForward: (context: string) => void
  refreshing: boolean
  allForwarding: Set<string>
  allForwardProgress: Map<string, { current: number; total: number }>
}

// 제외할 namespace 목록
const EXCLUDED_NAMESPACES = [
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'default',
  'argocd',
  'azp',
  'calico-system',
  'gateway',
  'migx',
  'projectcontour',
  'submarine',
  'submarine-acct',
  'test-ui',
  'tigera-operator',
]

export const ContextTree: React.FC<ContextTreeProps> = ({
  contexts,
  namespacesByContext,
  visibleNamespacesByContext,
  expandedContexts,
  portForwards,
  onToggleContext,
  onToggleNamespace,
  onSelectAllNamespaces,
  onDeselectAllNamespaces,
  onSelectOnlyNamespace,
  onRefresh,
  onAllForward,
  refreshing,
  allForwarding,
  allForwardProgress,
}) => {
  // 선택된 컨텍스트 상태
  const [selectedContext, setSelectedContext] = useState<string | null>(null)

  // expandedContexts가 변경될 때 selectedContext 동기화
  React.useEffect(() => {
    const expandedArray = Array.from(expandedContexts)
    if (expandedArray.length === 0) {
      // 모든 컨텍스트가 닫히면 selectedContext도 초기화
      setSelectedContext(null)
    } else if (expandedArray.length === 1) {
      // 하나의 컨텍스트만 열려있으면 그것을 selectedContext로 설정
      setSelectedContext(expandedArray[0])
    } else {
      // 여러 개가 열려있으면 (이론적으로는 발생하지 않아야 하지만) 첫 번째 것을 선택
      setSelectedContext(expandedArray[0])
    }
  }, [expandedContexts])

  // 각 Context의 필터링된 Namespace 목록
  const filteredNamespacesByContext = useMemo(() => {
    const map = new Map<string, Namespace[]>()
    for (const [context, namespaces] of namespacesByContext.entries()) {
      const filtered = namespaces.filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
      map.set(context, filtered)
    }
    return map
  }, [namespacesByContext])

  // 컨텍스트 목록을 세 부분으로 분리
  // 선택된 컨텍스트가 있고 확장되어 있을 때만 분리된 레이아웃 사용
  const { topContexts, selectedContextData, bottomContexts, useSplitLayout } = useMemo(() => {
    if (!selectedContext) {
      return { topContexts: contexts, selectedContextData: null, bottomContexts: [], useSplitLayout: false }
    }

    const isSelectedExpanded = expandedContexts.has(selectedContext)
    if (!isSelectedExpanded) {
      // 선택된 컨텍스트가 닫혀있으면 분리된 레이아웃 사용하지 않음
      return { topContexts: contexts, selectedContextData: null, bottomContexts: [], useSplitLayout: false }
    }

    const selectedIndex = contexts.findIndex(c => c.name === selectedContext)
    if (selectedIndex === -1) {
      return { topContexts: contexts, selectedContextData: null, bottomContexts: [], useSplitLayout: false }
    }

    // 선택된 컨텍스트를 제외한 상단 컨텍스트들
    const top = contexts.slice(0, selectedIndex)
    const selected = contexts[selectedIndex]
    const bottom = contexts.slice(selectedIndex + 1)

    return {
      topContexts: top,
      selectedContextData: selected,
      bottomContexts: bottom,
      useSplitLayout: true,
    }
  }, [contexts, selectedContext, expandedContexts])

  // 각 Context별로 포트포워딩 중인 pod 개수 계산
  const contextPortForwardCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [context, contextMap] of portForwards.entries()) {
      const podSet = new Set<string>()
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
          if (hasActivePortForward) {
            podSet.add(podName)
          }
        }
      }
      if (podSet.size > 0) {
        counts.set(context, podSet.size)
      }
    }
    return counts
  }, [portForwards])

  // 컨텍스트 노드 렌더링 함수
  const renderContextNode = (context: KubernetesContext, showChildren: boolean = false) => {
    const isExpanded = expandedContexts.has(context.name)
    const namespaces = filteredNamespacesByContext.get(context.name) || []
    const visibleNamespaces = visibleNamespacesByContext.get(context.name) || new Set()

    return (
      <div key={context.name} className="context-tree-node">
        <div 
          className={`context-tree-node-header ${isExpanded ? 'expanded' : ''}`}
          onClick={() => {
            setSelectedContext(context.name)
            onToggleContext(context.name)
          }}
        >
          <span className="tree-expand-icon">
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="context-tree-node-name">{context.name}</span>
          {contextPortForwardCounts.has(context.name) && (
            <span className="port-forward-count-badge">
              {contextPortForwardCounts.get(context.name)} pods
            </span>
          )}
          <div className="context-tree-node-actions">
            <button
              className="tree-all-forward-button"
              onClick={(e) => {
                e.stopPropagation()
                onAllForward(context.name)
              }}
              disabled={allForwarding.has(context.name)}
              title="Forward all services"
            >
              {allForwarding.has(context.name) ? (
                <>
                  <span className="all-forward-spinner">⟳</span>
                  <span>
                    {(() => {
                      const progress = allForwardProgress.get(context.name)
                      return progress ? `${progress.current}/${progress.total}` : 'forwarding...'
                    })()}
                  </span>
                </>
              ) : (
                'all forward'
              )}
            </button>
            <button
              className="tree-refresh-button"
              onClick={(e) => {
                e.stopPropagation()
                onRefresh(context.name)
              }}
              disabled={refreshing || allForwarding.has(context.name)}
              title="Refresh"
            >
              {refreshing ? '⟳' : '↻'}
            </button>
          </div>
        </div>
        {showChildren && (
          <div className={`context-tree-node-children ${isExpanded ? 'expanded' : ''}`}>
            {namespaces.length === 0 ? (
              <div className="empty-namespace-state">No namespaces</div>
            ) : (
              <>
                <div className="namespace-controls">
                  <button
                    className="namespace-control-button"
                    onClick={() => onSelectAllNamespaces(context.name)}
                    title="Select All"
                  >
                    all
                  </button>
                  <button
                    className="namespace-control-button"
                    onClick={() => onDeselectAllNamespaces(context.name)}
                    title="Deselect All"
                  >
                    clear
                  </button>
                </div>
                {namespaces
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((namespace) => {
                    const isVisible = visibleNamespaces.has(namespace.name)
                    return (
                      <div 
                        key={namespace.name} 
                        className={`namespace-tree-item ${isVisible ? 'selected' : ''}`}
                        onClick={(e) => {
                          // namespace-only-button을 클릭한 경우는 제외
                          if ((e.target as HTMLElement).closest('.namespace-only-button')) {
                            return
                          }
                          onToggleNamespace(context.name, namespace.name)
                        }}
                      >
                        <button
                          className="namespace-tree-toggle"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleNamespace(context.name, namespace.name)
                          }}
                          title={isVisible ? 'Deselect namespace' : 'Select namespace'}
                        >
                          <span className="namespace-tree-icon">{isVisible ? 'ν' : ''}</span>
                          <span className="namespace-tree-name">{namespace.name}</span>
                        </button>
                        <button
                          className="namespace-only-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectOnlyNamespace(context.name, namespace.name)
                          }}
                          title={`View ${namespace.name} only`}
                        >
                          Only
                        </button>
                      </div>
                    )
                  })}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="context-tree">
      <div className="context-tree-header">
        <h2>Contexts</h2>
      </div>
      {contexts.length === 0 ? (
        <div className="empty-state">No contexts</div>
      ) : useSplitLayout ? (
        <>
          {/* 상단 고정 영역 (선택된 컨텍스트 제외) */}
          {topContexts.length > 0 && (
            <div className="context-tree-top-section">
              {topContexts.map((context) => renderContextNode(context, false))}
            </div>
          )}
          {/* 중간 스크롤 영역 (선택된 컨텍스트의 namespace만) */}
          <div className="context-tree-scroll-section">
            {renderContextNode(selectedContextData, true)}
          </div>
          {/* 하단 고정 영역 */}
          {bottomContexts.length > 0 && (
            <div className="context-tree-bottom-section">
              {bottomContexts.map((context) => renderContextNode(context, false))}
            </div>
          )}
        </>
      ) : (
        /* 분리된 레이아웃을 사용하지 않을 때 모든 컨텍스트를 상단에 표시 */
        <div className="context-tree-content">
          {contexts.map((context) => renderContextNode(context, expandedContexts.has(context.name)))}
        </div>
      )}
    </div>
  )
}

