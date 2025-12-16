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
  refreshing: boolean
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
  refreshing,
}) => {
  // 각 Context의 필터링된 Namespace 목록
  const filteredNamespacesByContext = useMemo(() => {
    const map = new Map<string, Namespace[]>()
    for (const [context, namespaces] of namespacesByContext.entries()) {
      const filtered = namespaces.filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
      map.set(context, filtered)
    }
    return map
  }, [namespacesByContext])

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

  return (
    <div className="context-tree">
      <div className="context-tree-header">
        <h2>Contexts</h2>
      </div>
      <div className="context-tree-content">
        {contexts.length === 0 ? (
          <div className="empty-state">No contexts</div>
        ) : (
          contexts.map((context) => {
            const isExpanded = expandedContexts.has(context.name)
            const namespaces = filteredNamespacesByContext.get(context.name) || []
            const visibleNamespaces = visibleNamespacesByContext.get(context.name) || new Set()
            const allSelected = namespaces.length > 0 && namespaces.every(ns => visibleNamespaces.has(ns.name))
            const someSelected = namespaces.some(ns => visibleNamespaces.has(ns.name))

            return (
              <div key={context.name} className="context-tree-node">
                <div 
                  className="context-tree-node-header"
                  onClick={() => onToggleContext(context.name)}
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
                  {context.current && (
                    <span className="current-badge">Current</span>
                  )}
                  <div className="context-tree-node-actions">
                    <button
                      className="tree-refresh-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRefresh(context.name)
                      }}
                      disabled={refreshing}
                      title="Refresh"
                    >
                      {refreshing ? '⟳' : '↻'}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="context-tree-node-children">
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
          })
        )}
      </div>
    </div>
  )
}

