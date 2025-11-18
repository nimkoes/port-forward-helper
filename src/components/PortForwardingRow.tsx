import React, { useState, useEffect } from 'react'
import type { ContainerPort, PortForwardConfig } from '@/types'
import './PortForwardingRow.css'

interface PortForwardingRowProps {
  podName: string
  podNamespace?: string
  podStatus?: string
  podAge?: string
  port: ContainerPort
  portForward: PortForwardConfig | null
  onPortForwardChange: (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => void
}

export const PortForwardingRow: React.FC<PortForwardingRowProps> = ({
  podName,
  podNamespace,
  podStatus,
  podAge,
  port,
  portForward,
  onPortForwardChange,
}) => {
  const [localPort, setLocalPort] = useState<string>(
    portForward?.localPort.toString() || port.containerPort.toString()
  )
  const [isEnabled, setIsEnabled] = useState(portForward?.active || false)

  useEffect(() => {
    if (portForward) {
      setLocalPort(portForward.localPort.toString())
      setIsEnabled(portForward.active)
    } else {
      setLocalPort(port.containerPort.toString())
      setIsEnabled(false)
    }
  }, [portForward, port.containerPort])

  const handleToggle = (e: React.MouseEvent) => {
    // input 필드 클릭 시에는 토글하지 않음
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      return
    }
    
    const newEnabled = !isEnabled
    setIsEnabled(newEnabled)
    
    const localPortNum = parseInt(localPort, 10)
    if (isNaN(localPortNum) || localPortNum <= 0) {
      alert('유효한 로컬 포트 번호를 입력해주세요')
      setIsEnabled(false)
      return
    }

    onPortForwardChange(podName, port.containerPort, localPortNum, newEnabled)
  }

  const handleLocalPortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setLocalPort(value)
    
    // 포트포워딩이 활성화되어 있으면 업데이트
    if (isEnabled) {
      const localPortNum = parseInt(value, 10)
      if (!isNaN(localPortNum) && localPortNum > 0) {
        onPortForwardChange(podName, port.containerPort, localPortNum, true)
      }
    }
  }

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
        <span className="port-number-inline">{port.containerPort}</span>
        {port.name && (
          <span className="port-name-inline">{port.name}</span>
        )}
        <input
          type="number"
          className="local-port-input-inline"
          value={localPort}
          onChange={handleLocalPortChange}
          onClick={(e) => e.stopPropagation()}
          placeholder="외부 포트"
          min="1"
          max="65535"
          disabled={isEnabled}
        />
      </div>
    </div>
  )
}

