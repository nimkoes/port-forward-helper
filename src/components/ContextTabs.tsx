import React from 'react'
import type { KubernetesContext } from '@/types'
import './ContextTabs.css'

interface ContextTabsProps {
  contexts: KubernetesContext[]
  activeContext: string | null
  onContextChange: (context: string) => void
  onRefresh: (context: string) => void
  refreshing: boolean
}

export const ContextTabs: React.FC<ContextTabsProps> = ({
  contexts,
  activeContext,
  onContextChange,
  onRefresh,
  refreshing,
}) => {
  return (
    <div className="context-tabs">
      <div className="context-tabs-header">
        <h1 className="app-title">Kubernetes Port Forward Helper</h1>
        <div className="context-tabs-list">
          {contexts.length === 0 ? (
            <div className="no-contexts-message">컨텍스트를 로딩 중...</div>
          ) : (
            contexts.map((context) => (
              <div
                key={context.name}
                className={`context-tab ${activeContext === context.name ? 'active' : ''}`}
              >
                <button
                  className="context-tab-button"
                  onClick={() => onContextChange(context.name)}
                >
                  <span className="context-name">{context.name}</span>
                  {context.current && (
                    <span className="current-badge">현재</span>
                  )}
                </button>
                {activeContext === context.name && (
                  <button
                    className="refresh-button"
                    onClick={() => onRefresh(context.name)}
                    disabled={refreshing}
                    title="새로고침"
                  >
                    {refreshing ? '⟳' : '↻'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

