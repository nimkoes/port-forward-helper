import React, { useState, useEffect } from 'react'
import type { ContainerPort, PortForwardConfig } from '@/types'
import { formatDomainForDisplay } from '@/utils/domain'
import './PortForwardingRow.css'

interface PortForwardingRowProps {
  podName: string
  podNamespace?: string
  podStatus?: string
  podAge?: string
  podDeployment?: string
  podContext?: string
  port: ContainerPort
  portForward: PortForwardConfig | null
  onPortForwardChange: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => Promise<void>
}

export const PortForwardingRow: React.FC<PortForwardingRowProps> = ({
  podName,
  podNamespace,
  podStatus,
  podAge,
  podDeployment,
  podContext,
  port,
  portForward,
  onPortForwardChange,
}) => {
  const [isEnabled, setIsEnabled] = useState(portForward?.active || false)

  useEffect(() => {
    setIsEnabled(portForward?.active || false)
  }, [portForward])

  const handleToggle = async (e: React.MouseEvent) => {
    const newEnabled = !isEnabled
    const previousEnabled = isEnabled
    setIsEnabled(newEnabled)
    
    // 포트포워딩이 활성화되어 있으면 localPort 사용, 없으면 remotePort를 localPort로 사용
    const localPortNum = portForward?.localPort || port.containerPort

    try {
      await onPortForwardChange(podName, port.containerPort, localPortNum, newEnabled)
    } catch (error) {
      // 포트포워딩 실패 시 상태 롤백
      setIsEnabled(previousEnabled)
    }
  }

  // 도메인 표시용 텍스트 생성
  const displayDomain = portForward?.domain 
    ? formatDomainForDisplay(portForward.domain)
    : podDeployment && podNamespace
    ? formatDomainForDisplay(`${podDeployment}.${podNamespace}.${podContext || ''}`)
    : null

  return (
    <div 
      className={`port-forwarding-row ${isEnabled ? 'port-forwarding-active' : 'port-forwarding-inactive'}`}
      onClick={handleToggle}
      data-pod-name={podName}
      data-namespace={podNamespace}
      data-remote-port={port.containerPort}
    >
      <div className="pod-row-content">
        {podNamespace && (
          <span className="pod-namespace-inline">{podNamespace}</span>
        )}
        <span className="pod-name-inline">{podName}</span>
        {podStatus && (
          <span className={`pod-status-inline pod-status-${podStatus.toLowerCase()}`}>
            {podStatus}
          </span>
        )}
        {podAge && (
          <span className="pod-age-inline">{podAge}</span>
        )}
        {displayDomain && isEnabled && (
          <span className="domain-display" title={`http://${portForward?.domain || `${podDeployment}.${podNamespace}.${podContext}`}`}>
            🌐 {displayDomain}
          </span>
        )}
        {port.name && (
          <span className="port-name-inline">{port.name}</span>
        )}
      </div>
    </div>
  )
}

