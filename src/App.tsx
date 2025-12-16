import React, { useState, useEffect, useCallback } from 'react'
import { ContextTabs } from './components/ContextTabs'
import { NamespaceList } from './components/NamespaceList'
import { PodList } from './components/PodList'
import { ActivePortForwards } from './components/ActivePortForwards'
import { useKubectl } from './hooks/useKubectl'
import { usePortForward } from './hooks/usePortForward'
import { getAllowedNamespaces } from './utils/config'
import { generateDomain } from './utils/domain'
import type { KubernetesContext, Namespace, Pod, PortForwardConfig } from './types'
import './App.css'

function App() {
  const { fetchContexts, fetchNamespaces, fetchPods } = useKubectl()
  const { startPortForward, stopPortForward } = usePortForward()

  const [contexts, setContexts] = useState<KubernetesContext[]>([])
  const [activeContext, setActiveContext] = useState<string | null>(null)
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  // 컨텍스트별로 선택된 네임스페이스를 저장 (Map<context, Set<namespace>>)
  const [visibleNamespacesByContext, setVisibleNamespacesByContext] = useState<Map<string, Set<string>>>(new Map())
  const [podsByNamespace, setPodsByNamespace] = useState<Map<string, Pod[]>>(new Map())
  const [portForwards, setPortForwards] = useState<Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>>(new Map())
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proxyServerPort, setProxyServerPort] = useState<number | null>(null)
  const [lastHostsDomains, setLastHostsDomains] = useState<string[]>([])
  // hosts 파일 수정은 기본적으로 비활성화 (비밀번호 요청 방지)
  const [enableHostsModification, setEnableHostsModification] = useState(true)

  // 현재 활성 컨텍스트의 선택된 네임스페이스를 가져오는 헬퍼 함수
  const getVisibleNamespacesForContext = useCallback((context: string | null): Set<string> => {
    if (!context) return new Set()
    return visibleNamespacesByContext.get(context) || new Set()
  }, [visibleNamespacesByContext])

  // 초기 컨텍스트 로드
  useEffect(() => {
    loadContexts()
  }, [])

  // 컨텍스트 변경 시 네임스페이스 및 Pod 로드
  useEffect(() => {
    if (activeContext) {
      loadDataForContext(activeContext)
    }
  }, [activeContext])

  const loadContexts = async () => {
    setError(null)
    try {
      const loadedContexts = await fetchContexts()
      
      if (loadedContexts.length === 0) {
        setError('No available Kubernetes contexts. Please check with kubectl config get-contexts.')
        return
      }
      
      setContexts(loadedContexts)
      
      // 현재 컨텍스트 또는 첫 번째 컨텍스트를 활성화
      const currentContext = loadedContexts.find(ctx => ctx.current) || loadedContexts[0]
      if (currentContext) {
        setActiveContext(currentContext.name)
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to load contexts'
      console.error('Failed to load contexts:', error)
      setError(errorMessage)
    }
  }

  const loadDataForContext = async (context: string) => {
    setLoading(true)
    setError(null)
    try {
      // 네임스페이스 로드만 수행 (Pod는 선택 시 로드)
      const loadedNamespaces = await fetchNamespaces(context)
      setNamespaces(loadedNamespaces)
      
      // 저장된 선택 상태를 복원 (없으면 빈 Set)
      const savedVisibleNamespaces = visibleNamespacesByContext.get(context) || new Set<string>()
      
      // 로드된 네임스페이스 중에서만 유효한 선택 상태 필터링
      const validVisibleNamespaces = new Set<string>()
      for (const ns of savedVisibleNamespaces) {
        if (loadedNamespaces.some(loadedNs => loadedNs.name === ns)) {
          validVisibleNamespaces.add(ns)
        }
      }
      
      // 유효한 선택 상태를 저장
      setVisibleNamespacesByContext(prev => {
        const newMap = new Map(prev)
        newMap.set(context, validVisibleNamespaces)
        return newMap
      })

      // 선택된 네임스페이스의 Pod를 로드
      if (validVisibleNamespaces.size > 0) {
        await loadPodsForNamespaces(context, Array.from(validVisibleNamespaces), false)
      } else {
        // Pod는 선택된 네임스페이스에 대해서만 로드하므로 여기서는 초기화만
        setPodsByNamespace(new Map())
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to load data'
      console.error('Failed to load data:', error)
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // 선택된 네임스페이스의 Pod를 로드 (병렬 처리)
  const loadPodsForNamespaces = useCallback(async (context: string, namespaceNames: string[], setLoadingState: boolean = true) => {
    if (namespaceNames.length === 0) {
      setPodsByNamespace(new Map())
      return
    }

    if (setLoadingState) {
      setLoading(true)
    }
    try {
      // 병렬로 모든 네임스페이스의 Pod 로드
      // 이미 로드된 네임스페이스도 포함하여 최신 데이터로 갱신
      const podPromises = namespaceNames.map(async (namespace) => {
        try {
          const pods = await fetchPods(context, namespace)
          return { namespace, pods }
        } catch (error) {
          console.error(`Failed to load pods for namespace ${namespace}:`, error)
          return { namespace, pods: [] }
        }
      })

      const results = await Promise.all(podPromises)
      
      // 기존 Pod 데이터와 병합
      setPodsByNamespace(prev => {
        const newMap = new Map(prev)
        results.forEach(({ namespace, pods }) => {
          newMap.set(namespace, pods)
        })
        return newMap
      })
    } catch (error) {
      console.error('Failed to load pods:', error)
    } finally {
      if (setLoadingState) {
        setLoading(false)
      }
    }
  }, [fetchPods])

  const handleRefresh = async (context: string) => {
    setRefreshing(true)
    try {
      // 현재 선택된 네임스페이스를 가져옴
      const currentSelectedNamespaces = getVisibleNamespacesForContext(context)
      
      // 네임스페이스 목록만 새로고침 (선택은 유지)
      setLoading(true)
      setError(null)
      try {
        const loadedNamespaces = await fetchNamespaces(context)
        setNamespaces(loadedNamespaces)
        
        // 선택된 네임스페이스 복원 (로드된 네임스페이스 중에서만)
        const validSelectedNamespaces = Array.from(currentSelectedNamespaces).filter(ns => 
          loadedNamespaces.some(loadedNs => loadedNs.name === ns)
        )
        
        // 유효한 선택 상태를 저장
        setVisibleNamespacesByContext(prev => {
          const newMap = new Map(prev)
          newMap.set(context, new Set(validSelectedNamespaces))
          return newMap
        })
        
        // 선택된 네임스페이스의 Pod만 다시 로드 (로딩 상태는 handleRefresh에서 관리)
        if (validSelectedNamespaces.length > 0) {
          await loadPodsForNamespaces(context, validSelectedNamespaces, false)
        } else {
          // 선택된 네임스페이스가 없으면 Pod 데이터 초기화
          setPodsByNamespace(new Map())
        }
      } catch (error: any) {
        const errorMessage = error?.message || 'Failed to load data'
        console.error('Failed to load data:', error)
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    } finally {
      setRefreshing(false)
    }
  }

  const handleContextChange = (context: string) => {
    setActiveContext(context)
  }

  const handleToggleNamespace = (namespace: string) => {
    if (!activeContext) return
    
    setVisibleNamespacesByContext(prev => {
      const newMap = new Map(prev)
      const currentSet = newMap.get(activeContext) || new Set<string>()
      const newSet = new Set(currentSet)
      
      if (newSet.has(namespace)) {
        newSet.delete(namespace)
        // Pod 데이터도 제거 (메모리 최적화)
        setPodsByNamespace(prevPods => {
          const newPods = new Map(prevPods)
          newPods.delete(namespace)
          return newPods
        })
      } else {
        newSet.add(namespace)
        // 새로 선택된 네임스페이스의 Pod 로드 (이미 로드된 경우에도 최신 데이터로 갱신)
        loadPodsForNamespaces(activeContext, [namespace])
      }
      
      newMap.set(activeContext, newSet)
      return newMap
    })
  }

  // 모든 활성 포트포워딩의 외부 포트 목록 수집
  const activeLocalPorts = React.useMemo(() => {
    const ports = new Set<number>()
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          for (const [remotePort, config] of podMap.entries()) {
            if (config.active) {
              ports.add(config.localPort)
            }
          }
        }
      }
    }
    return ports
  }, [portForwards])

  // 사용 가능한 포트를 찾는 헬퍼 함수
  const findAvailablePort = useCallback((startPort: number, activePorts: Set<number>): number | null => {
    for (let port = startPort; port <= 65535; port++) {
      if (!activePorts.has(port)) {
        return port
      }
    }
    return null
  }, [])

  // 프록시 서버와 hosts 파일 업데이트 (useEffect보다 먼저 정의되어야 함)
  const updateProxyAndHosts = useCallback(async () => {
    if (!window.electronAPI) {
      console.warn('[App] electronAPI not available yet')
      return
    }

    // 모든 활성 포트포워딩 수집
    const activeRoutes = new Map<string, number>()
    const activeDomains: string[] = []

    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          for (const [remotePort, config] of podMap.entries()) {
            if (config.active && config.domain) {
              activeRoutes.set(config.domain, config.localPort)
              activeDomains.push(config.domain)
            }
          }
        }
      }
    }

    // 프록시 서버 시작 (활성 포트포워딩이 있고 서버가 실행 중이 아니면)
    if (activeRoutes.size > 0 && !proxyServerPort) {
      try {
        const result = await window.electronAPI.startProxyServer(80)
        if (result.success && result.port) {
          setProxyServerPort(result.port)
        } else {
          console.error('Failed to start proxy server:', result.error)
        }
      } catch (error) {
        console.error('Failed to start proxy server:', error)
      }
    }

    // 프록시 서버 라우팅 업데이트
    if (activeRoutes.size > 0 && proxyServerPort) {
      try {
        const routesObj: Record<string, number> = {}
        for (const [domain, port] of activeRoutes.entries()) {
          routesObj[domain] = port
        }
        await window.electronAPI.updateProxyRoutes(routesObj)
      } catch (error) {
        console.error('Failed to update proxy routes:', error)
      }
    }

    // hosts 파일 업데이트 (사용자가 활성화한 경우에만, 변경된 경우에만)
    if (enableHostsModification) {
      const domainsChanged = 
        activeDomains.length !== lastHostsDomains.length ||
        activeDomains.some((domain, index) => domain !== lastHostsDomains[index]) ||
        lastHostsDomains.some((domain, index) => domain !== activeDomains[index])
      
      if (domainsChanged) {
        try {
          console.log('[App] Attempting to update hosts file with domains:', activeDomains)
          const result = await window.electronAPI.updateHostsDomains(activeDomains)
          if (result && result.success) {
            setLastHostsDomains(activeDomains)
            console.log('[App] Hosts file updated successfully with domains:', activeDomains)
          } else {
            console.error('[App] Failed to update hosts file:', result?.error || 'Unknown error')
            alert(`Failed to update hosts file: ${result?.error || 'Unknown error'}\n\nYou may need to run the application with administrator privileges.`)
          }
        } catch (error) {
          console.error('[App] Failed to update hosts file:', error)
          const errorMessage = error instanceof Error ? error.message : String(error)
          alert(`Failed to update hosts file: ${errorMessage}\n\nYou may need to run the application with administrator privileges.`)
        }
      }
    } else {
      // hosts 파일 수정이 비활성화되어 있으면 이전 도메인 목록 초기화
      if (lastHostsDomains.length > 0) {
        setLastHostsDomains([])
      }
    }

    // 모든 포트포워딩이 비활성화되면 프록시 서버 종료
    if (activeRoutes.size === 0 && proxyServerPort) {
      try {
        await window.electronAPI.stopProxyServer()
        setProxyServerPort(null)
      } catch (error) {
        console.error('Failed to stop proxy server:', error)
      }
    }
  }, [portForwards, proxyServerPort, lastHostsDomains, enableHostsModification])

  // portForwards 변경 시 프록시 서버와 hosts 파일 자동 업데이트
  useEffect(() => {
    // electronAPI가 준비될 때까지 대기
    if (!window.electronAPI) {
      const checkAPI = setInterval(() => {
        if (window.electronAPI) {
          clearInterval(checkAPI)
          updateProxyAndHosts()
        }
      }, 100)
      return () => clearInterval(checkAPI)
    }
    updateProxyAndHosts()
  }, [portForwards, updateProxyAndHosts])

  const handlePortForwardChange = useCallback(async (
    podName: string,
    remotePort: number,
    localPort: number,
    enabled: boolean
  ) => {
    if (!activeContext) return

    // Pod 정보 찾기
    let podNamespace = ''
    let podDeployment: string | undefined
    for (const [namespace, pods] of podsByNamespace.entries()) {
      const pod = pods.find(p => p.name === podName)
      if (pod) {
        podNamespace = namespace
        podDeployment = pod.deployment || podName
        break
      }
    }

    if (!podNamespace) {
      console.error('Cannot find namespace for pod:', podName)
      return
    }

    const configKey = `${activeContext}:${podNamespace}:${podName}`

    if (enabled) {
      // 포트 중복 체크 및 자동 포트 찾기
      let portToUse = localPort
      if (activeLocalPorts.has(localPort)) {
        // 중복된 포트인 경우 사용 가능한 포트 자동 찾기
        const availablePort = findAvailablePort(localPort, activeLocalPorts)
        if (availablePort === null) {
          alert('No available port found (tried up to 65535)')
          throw new Error('No available port found')
        }
        portToUse = availablePort
      }

      // 도메인 생성 (podDeployment가 없으면 podName 사용)
      const deploymentName = podDeployment || podName
      const domain = generateDomain(deploymentName, podNamespace, activeContext)

      // 포트포워딩 시작
      try {
        const pid = await startPortForward(
          activeContext,
          podNamespace,
          podName,
          portToUse,
          remotePort
        )

        const config: PortForwardConfig = {
          id: `${configKey}:${remotePort}`,
          context: activeContext,
          namespace: podNamespace,
          pod: podName,
          localPort: portToUse,
          remotePort,
          pid,
          active: true,
          domain,
        }

        setPortForwards(prev => {
          const newMap = new Map(prev)
          if (!newMap.has(activeContext)) {
            newMap.set(activeContext, new Map())
          }
          const contextMap = newMap.get(activeContext)!
          if (!contextMap.has(podNamespace)) {
            contextMap.set(podNamespace, new Map())
          }
          const namespaceMap = contextMap.get(podNamespace)!
          if (!namespaceMap.has(podName)) {
            namespaceMap.set(podName, new Map())
          }
          const podMap = namespaceMap.get(podName)!
          podMap.set(remotePort, config)
          return newMap
        })
      } catch (error) {
        console.error('Failed to start port forward:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (!errorMessage.includes('already in use')) {
          alert(`Failed to start port forward: ${errorMessage}`)
        }
        throw error
      }
    } else {
      // 포트포워딩 중지
      const contextMap = portForwards.get(activeContext)
      const namespaceMap = contextMap?.get(podNamespace)
      const podMap = namespaceMap?.get(podName)
      const config = podMap?.get(remotePort)

      if (config?.pid) {
        try {
          await stopPortForward(config.pid)
          
          setPortForwards(prev => {
            const newMap = new Map(prev)
            const ctxMap = newMap.get(activeContext)
            const nsMap = ctxMap?.get(podNamespace)
            const pMap = nsMap?.get(podName)
            if (pMap) {
              pMap.delete(remotePort)
              if (pMap.size === 0) {
                nsMap?.delete(podName)
                if (nsMap?.size === 0) {
                  ctxMap?.delete(podNamespace)
                  if (ctxMap?.size === 0) {
                    newMap.delete(activeContext)
                  }
                }
              }
            }
            return newMap
          })
        } catch (error) {
          console.error('Failed to stop port forward:', error)
          alert(`Failed to stop port forward: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }, [activeContext, podsByNamespace, portForwards, activeLocalPorts, findAvailablePort, startPortForward, stopPortForward, updateProxyAndHosts])


  // 현재 컨텍스트의 보이는 네임스페이스의 Pod 목록
  const visiblePods = React.useMemo(() => {
    if (!activeContext) return []
    
    const visibleNamespaces = getVisibleNamespacesForContext(activeContext)
    const allPods: Pod[] = []
    for (const namespace of visibleNamespaces) {
      const pods = podsByNamespace.get(namespace) || []
      allPods.push(...pods)
    }
    return allPods
  }, [activeContext, visibleNamespacesByContext, podsByNamespace, getVisibleNamespacesForContext])

  // 현재 컨텍스트의 포트포워딩 맵 (Pod 이름 -> 포트 번호 -> 설정)
  const currentPortForwards = React.useMemo(() => {
    if (!activeContext) return new Map()
    
    const visibleNamespaces = getVisibleNamespacesForContext(activeContext)
    const contextMap = portForwards.get(activeContext) || new Map()
    const result = new Map<string, Map<number, PortForwardConfig>>()
    
    for (const [namespace, namespaceMap] of contextMap.entries()) {
      if (visibleNamespaces.has(namespace)) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          result.set(podName, podMap)
        }
      }
    }
    
    return result
  }, [activeContext, portForwards, visibleNamespacesByContext, getVisibleNamespacesForContext])

  // 활성 포트포워딩 클릭 시 해당 위치로 스크롤
  const handleScrollToPortForward = useCallback(async (
    context: string,
    namespace: string,
    podName: string,
    remotePort: number
  ) => {
    // 컨텍스트가 다른 경우 컨텍스트 전환
    if (activeContext !== context) {
      setActiveContext(context)
      // 컨텍스트 전환 후 데이터 로드를 기다림
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // 네임스페이스가 선택되지 않은 경우 선택
    const visibleNamespaces = getVisibleNamespacesForContext(context)
    if (!visibleNamespaces.has(namespace)) {
      setVisibleNamespacesByContext(prev => {
        const newMap = new Map(prev)
        const currentSet = newMap.get(context) || new Set<string>()
        const newSet = new Set(currentSet)
        newSet.add(namespace)
        newMap.set(context, newSet)
        return newMap
      })
      // Pod 로드 대기
      await loadPodsForNamespaces(context, [namespace])
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // DOM에서 해당 요소 찾기
    const targetElement = document.querySelector(
      `[data-pod-name="${podName}"][data-namespace="${namespace}"][data-remote-port="${remotePort}"]`
    )

    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      // 하이라이트 효과 (선택사항)
      targetElement.classList.add('highlight-scroll-target')
      setTimeout(() => {
        targetElement.classList.remove('highlight-scroll-target')
      }, 2000)
    }
  }, [activeContext, getVisibleNamespacesForContext, loadPodsForNamespaces])

  // 모든 활성 포트포워딩 비활성화
  const handleDisableAllPortForwards = useCallback(async () => {
    const activePortForwardsList: Array<{
      context: string
      namespace: string
      podName: string
      remotePort: number
      localPort: number
    }> = []

    // 모든 활성 포트포워딩 수집
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          for (const [remotePort, config] of podMap.entries()) {
            if (config.active) {
              activePortForwardsList.push({
                context,
                namespace,
                podName,
                remotePort,
                localPort: config.localPort,
              })
            }
          }
        }
      }
    }

    // 각 포트포워딩을 순차적으로 비활성화
    for (const item of activePortForwardsList) {
      // 컨텍스트가 다른 경우 컨텍스트 전환
      if (activeContext !== item.context && handleContextChange) {
        handleContextChange(item.context)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      
      try {
        await handlePortForwardChange(
          item.podName,
          item.remotePort,
          item.localPort,
          false
        )
      } catch (error) {
        console.error(`Failed to disable port forward for ${item.podName}:${item.remotePort}`, error)
      }
    }
  }, [portForwards, activeContext, handleContextChange, handlePortForwardChange])

  return (
    <div className="app">
      <ContextTabs
        contexts={contexts}
        activeContext={activeContext}
        onContextChange={handleContextChange}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      <div className="app-content">
        <NamespaceList
          namespaces={namespaces}
          visibleNamespaces={getVisibleNamespacesForContext(activeContext)}
          onToggleNamespace={handleToggleNamespace}
          onSelectAll={() => {
            if (!activeContext) return
            const allowedNamespacesSet = getAllowedNamespaces()
            const allowedNamespaces = namespaces
              .filter(ns => allowedNamespacesSet.has(ns.name))
              .map(ns => ns.name)
            
            setVisibleNamespacesByContext(prev => {
              const newMap = new Map(prev)
              newMap.set(activeContext, new Set(allowedNamespaces))
              return newMap
            })
            
            // 선택된 모든 네임스페이스의 Pod 병렬 로드
            loadPodsForNamespaces(activeContext, allowedNamespaces)
          }}
          onDeselectAll={() => {
            if (!activeContext) return
            setVisibleNamespacesByContext(prev => {
              const newMap = new Map(prev)
              newMap.set(activeContext, new Set())
              return newMap
            })
            setPodsByNamespace(new Map())
          }}
          onSelectOnly={(namespace) => {
            if (!activeContext) return
            setVisibleNamespacesByContext(prev => {
              const newMap = new Map(prev)
              newMap.set(activeContext, new Set([namespace]))
              return newMap
            })
            // 선택된 네임스페이스의 Pod만 로드
            loadPodsForNamespaces(activeContext, [namespace])
          }}
        />
        <div className="main-content">
          {error ? (
            <div className="error-state">
              <div className="error-message">
                <h3>Error</h3>
                <p>{error}</p>
                <button 
                  className="retry-button"
                  onClick={() => {
                    if (activeContext) {
                      loadDataForContext(activeContext)
                    } else {
                      loadContexts()
                    }
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading...</p>
            </div>
          ) : (
            <PodList
              pods={visiblePods}
              portForwards={currentPortForwards}
              activeContext={activeContext}
              onPortForwardChange={handlePortForwardChange}
            />
          )}
        </div>
        <ActivePortForwards
          portForwards={portForwards}
          podsByNamespace={podsByNamespace}
          activeContext={activeContext}
          activeLocalPorts={activeLocalPorts}
          onPortForwardChange={handlePortForwardChange}
          onContextChange={handleContextChange}
          onItemClick={handleScrollToPortForward}
          onDisableAll={handleDisableAllPortForwards}
        />
      </div>
    </div>
  )
}

export default App

