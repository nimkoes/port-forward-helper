import React, { useState, useEffect, useMemo, useCallback } from 'react'
import type { ContainerPort, PortForwardConfig } from '@/types'
import { getNamespaceDefaultPorts } from '@/utils/config'
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
  ) => Promise<void>
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
  // 네임스페이스별 기본 포트 가져오기
  const namespaceDefaultPorts = useMemo(() => getNamespaceDefaultPorts(), [])
  
  // 기본 포트 결정: 포트포워딩이 있으면 그것을 사용, 없으면 네임스페이스 기본 포트 또는 containerPort
  const getDefaultPort = useCallback((): number => {
    if (portForward) {
      return portForward.localPort
    }
    if (podNamespace) {
      const defaultPort = namespaceDefaultPorts.get(podNamespace)
      if (defaultPort !== undefined) {
        console.log(`[PortForwardingRow] 네임스페이스 "${podNamespace}"의 기본 포트 사용: ${defaultPort}`)
        return defaultPort
      } else {
        console.log(`[PortForwardingRow] 네임스페이스 "${podNamespace}"에 기본 포트가 설정되지 않음, containerPort 사용: ${port.containerPort}`)
      }
    }
    return port.containerPort
  }, [portForward, podNamespace, namespaceDefaultPorts, port.containerPort])

  // 초기값은 containerPort로 설정하고, useEffect에서 네임스페이스 기본 포트를 적용
  const [localPort, setLocalPort] = useState<string>(
    port.containerPort.toString()
  )
  const [isEnabled, setIsEnabled] = useState(portForward?.active || false)

  useEffect(() => {
    if (portForward) {
      // 포트포워딩이 활성화되어 있으면 그 포트 사용
      setLocalPort(portForward.localPort.toString())
      setIsEnabled(portForward.active)
    } else {
      // 포트포워딩이 없으면 네임스페이스 기본 포트 또는 containerPort 사용
      // getDefaultPort는 podNamespace를 dependency로 가지고 있어서,
      // podNamespace가 변경되면 자동으로 최신 네임스페이스 기본 포트를 가져옴
      const defaultPort = getDefaultPort()
      setLocalPort(defaultPort.toString())
      setIsEnabled(false)
    }
    // getDefaultPort의 dependency에 podNamespace가 포함되어 있어서,
    // podNamespace 변경 시에도 이 useEffect가 실행됨
  }, [portForward, getDefaultPort])

  const handleToggle = async (e: React.MouseEvent) => {
    // input 필드 클릭 시에는 토글하지 않음
    if ((e.target as HTMLElement).tagName === 'INPUT') {
      return
    }
    
    const newEnabled = !isEnabled
    const previousEnabled = isEnabled
    setIsEnabled(newEnabled)
    
    const localPortNum = parseInt(localPort, 10)
    if (isNaN(localPortNum) || localPortNum <= 0) {
      alert('Please enter a valid local port number')
      setIsEnabled(previousEnabled)
      return
    }

    try {
      await onPortForwardChange(podName, port.containerPort, localPortNum, newEnabled)
    } catch (error) {
      // 포트포워딩 실패 시 상태 롤백
      setIsEnabled(previousEnabled)
    }
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
          placeholder="Local Port"
          min="1"
          max="65535"
          disabled={isEnabled}
        />
      </div>
    </div>
  )
}

