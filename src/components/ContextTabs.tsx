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
            <div className="no-contexts-message">Loading contexts...</div>
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
                    <span className="current-badge">Current</span>
                  )}
                </button>
                {activeContext === context.name && (
                  <button
                    className="refresh-button"
                    onClick={() => onRefresh(context.name)}
                    disabled={refreshing}
                    title="Refresh"
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

