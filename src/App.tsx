import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ContextTree } from './components/ContextTree'
import { PodList } from './components/PodList'
import { GlobalNavBar } from './components/GlobalNavBar'
import { useKubectl } from './hooks/useKubectl'
import { usePortForward } from './hooks/usePortForward'
import { getServices, getPods } from './utils/kubectl'
import { generateServiceUrl, extractHostsDomain, generateDomain } from './utils/domain'
import type { KubernetesContext, Namespace, Pod, PortForwardConfig, Service } from './types'
import './App.css'

// 제외할 namespace 목록 (시스템 + 사용자 지정)
const EXCLUDED_NAMESPACES = [
  // 시스템 namespace
  'kube-system',
  'kube-public',
  'kube-node-lease',
  // 사용자 지정 제외 namespace
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

function App() {
  const { fetchContexts, fetchNamespaces, fetchPods } = useKubectl()
  const { startPortForward, stopPortForward } = usePortForward()

  const [contexts, setContexts] = useState<KubernetesContext[]>([])
  const [activeContext, setActiveContext] = useState<string | null>(null)
  const [namespaces, setNamespaces] = useState<Namespace[]>([])
  // 컨텍스트별로 선택된 네임스페이스를 저장 (Map<context, Set<namespace>>)
  const [visibleNamespacesByContext, setVisibleNamespacesByContext] = useState<Map<string, Set<string>>>(new Map())
  const [podsByNamespace, setPodsByNamespace] = useState<Map<string, Pod[]>>(new Map())
  
  // 성능 최적화: Pod 이름으로 빠르게 조회하기 위한 Map (Map<podName, { namespace: string, pod: Pod }>)
  const podsByNameMap = useMemo(() => {
    const map = new Map<string, { namespace: string; pod: Pod }>()
    for (const [namespace, pods] of podsByNamespace.entries()) {
      for (const pod of pods) {
        map.set(pod.name, { namespace, pod })
      }
    }
    return map
  }, [podsByNamespace])
  const [portForwards, setPortForwards] = useState<Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>>(new Map())
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [allForwarding, setAllForwarding] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [proxyServerPort, setProxyServerPort] = useState<number | null>(null)
  const proxyServerPortRef = useRef<number | null>(null)
  const lastHostsDomainsRef = useRef<string[]>([]) // lastHostsDomains를 위한 ref (무한 루프 방지)
  
  // proxyServerPort 변경 시 ref도 업데이트
  useEffect(() => {
    proxyServerPortRef.current = proxyServerPort
  }, [proxyServerPort])
  // hosts 파일 수정은 기본적으로 비활성화 (비밀번호 요청 방지)
  const [enableHostsModification, setEnableHostsModification] = useState(true)
  // 컨텍스트별로 선택된 Pod를 저장 (Map<context, Set<podName>>)
  const [selectedPodsByContext, setSelectedPodsByContext] = useState<Map<string, Set<string>>>(new Map())
  // 컨텍스트별로 확장된 Deployment를 저장 (Map<context, Set<deployment>>)
  const [expandedDeploymentsByContext, setExpandedDeploymentsByContext] = useState<Map<string, Set<string>>>(new Map())
  // 캐시: 컨텍스트별로 Service 정보를 저장 (Map<context, Map<namespace, Service[]>>)
  const [servicesByContextAndNamespace, setServicesByContextAndNamespace] = useState<Map<string, Map<string, Service[]>>>(new Map())
  // 확장된 Context를 저장 (트리 구조용)
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set())
  // 캐시: 컨텍스트별 Namespace 목록 저장 (Map<context, Namespace[]>)
  const [namespacesByContext, setNamespacesByContext] = useState<Map<string, Namespace[]>>(new Map())
  // 캐시: 네임스페이스별 Pod 목록 저장 (Map<namespace, Pod[]>)
  // podsByNamespace는 이미 위에서 정의됨

  // 현재 활성 컨텍스트의 선택된 네임스페이스를 가져오는 헬퍼 함수
  const getVisibleNamespacesForContext = useCallback((context: string | null): Set<string> => {
    if (!context) return new Set()
    return visibleNamespacesByContext.get(context) || new Set()
  }, [visibleNamespacesByContext])

  // 초기 컨텍스트 로드
  const loadContexts = useCallback(async () => {
    setError(null)
    try {
      const loadedContexts = await fetchContexts()
      
      if (loadedContexts.length === 0) {
        setError('No available Kubernetes contexts. Please check with kubectl config get-contexts.')
        return
      }
      
      setContexts(loadedContexts)
      
      // 초기에는 컨텍스트를 선택하지 않음 (사용자가 직접 선택해야 함)
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to load contexts'
      console.error('Failed to load contexts:', error)
      setError(errorMessage)
    }
  }, [fetchContexts])

  useEffect(() => {
    loadContexts()
  }, [loadContexts])

  // HTTP 프로토콜 판단 헬퍼 함수
  const isHttpPort = useCallback((servicePort: { name?: string }, podPort: { name?: string; containerPort: number }): boolean => {
    // Service 포트 이름에 "http"가 포함되어 있는지 확인 (대소문자 무시)
    if (servicePort.name && servicePort.name.toLowerCase().includes('http')) {
      return true
    }
    // Pod 포트 이름에 "http"가 포함되어 있는지 확인
    if (podPort.name && podPort.name.toLowerCase().includes('http')) {
      return true
    }
    return false
  }, [])

  // Pod 기반 자동 포트포워딩 설정
  const setupPodPortForwards = useCallback(async (context: string) => {
    if (!window.electronAPI) {
      console.warn('[App] electronAPI not available yet')
      return
    }

    try {
      console.log(`[App] Setting up pod port forwards for context: ${context}`)
      
      // 1. 모든 namespace 조회 (제외할 namespace 제외)
      const allNamespaces = await fetchNamespaces(context)
      const namespaces = allNamespaces
        .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
        .map(ns => ns.name)
        .filter(ns => ns && ns.trim() !== '') // 빈 namespace 제거
      
      console.log(`[App] Found ${namespaces.length} namespaces to process:`, namespaces)
      
      // 2. 각 namespace의 모든 Pod와 Service 조회
      const podPortForwards: Array<{
        context: string
        namespace: string
        podName: string
        podPort: number
        serviceName?: string
        servicePort?: number
      }> = []

      for (const namespace of namespaces) {
        // namespace 유효성 재확인
        if (!namespace || typeof namespace !== 'string' || namespace.trim() === '') {
          console.warn(`[App] Skipping invalid namespace: ${namespace}`)
          continue
        }
        
        try {
          // Pod 조회
          const pods = await getPods(context, namespace)
          console.log(`[App] Found ${pods.length} pods in namespace ${namespace}`)
          
          // Service 조회 (HTTP 포트 판단을 위해)
          const services = await getServices(context, namespace)
          console.log(`[App] Found ${services.length} services in namespace ${namespace}`)
          
          // Service 정보 저장
          setServicesByContextAndNamespace(prev => {
            const newMap = new Map(prev)
            if (!newMap.has(context)) {
              newMap.set(context, new Map())
            }
            const contextMap = newMap.get(context)!
            contextMap.set(namespace, services)
            return newMap
          })
          
          // Pod와 Service 매칭을 위한 맵 생성
          const serviceMap = new Map<string, Service>()
          for (const service of services) {
            if (service.selector) {
              // Service의 selector로 매칭되는 Pod 찾기
              for (const pod of pods) {
                if (!pod.labels) continue
                let matches = true
                for (const [key, value] of Object.entries(service.selector)) {
                  if (pod.labels[key] !== value) {
                    matches = false
                    break
                  }
                }
                if (matches) {
                  // Pod 이름을 키로 Service 저장 (여러 Service가 있을 수 있으므로 첫 번째만 저장)
                  if (!serviceMap.has(pod.name)) {
                    serviceMap.set(pod.name, service)
                  }
                }
              }
            }
          }

          // Pod를 Deployment별로 그룹화
          const deploymentPodsMap = new Map<string, Pod[]>()
          for (const pod of pods) {
            const deployment = pod.deployment || pod.name
            if (!deploymentPodsMap.has(deployment)) {
              deploymentPodsMap.set(deployment, [])
            }
            deploymentPodsMap.get(deployment)!.push(pod)
          }

          // 각 Deployment에서 가장 최근 Pod 선택 및 포트포워딩 설정
          for (const [deployment, deploymentPods] of deploymentPodsMap.entries()) {
            // creationTimestamp 기준으로 정렬하여 가장 최근 Pod 선택
            const sortedPods = [...deploymentPods].sort((a, b) => {
              const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
              const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
              return bTime - aTime // 최신이 먼저
            })
            
            const latestPod = sortedPods[0]
            if (!latestPod) continue

            // Service 정보 가져오기
            const service = serviceMap.get(latestPod.name)

            // 각 포트에 대해 HTTP 포트인지 확인하고 포트포워딩 설정
            for (const podPort of latestPod.ports) {
              let isHttp = false
              
              if (service) {
                // Service의 포트 중 Pod 포트와 매칭되는 것 찾기
                for (const servicePort of service.ports) {
                  const targetPort = servicePort.targetPort
                  let matches = false
                  
                  if (typeof targetPort === 'number') {
                    matches = targetPort === podPort.containerPort
                  } else {
                    matches = targetPort === podPort.name
                  }
                  
                  if (matches) {
                    isHttp = isHttpPort(servicePort, podPort)
                    break
                  }
                }
              } else {
                // Service가 없으면 Pod 포트 이름만 확인
                isHttp = podPort.name ? podPort.name.toLowerCase().includes('http') : false
              }

              // HTTP 포트만 포트포워딩 설정
              if (isHttp) {
                podPortForwards.push({
                  context,
                  namespace,
                  podName: latestPod.name,
                  podPort: podPort.containerPort,
                  serviceName: service?.name,
                  servicePort: service?.ports.find(sp => {
                    const tp = sp.targetPort
                    return (typeof tp === 'number' && tp === podPort.containerPort) ||
                           (typeof tp === 'string' && tp === podPort.name)
                  })?.port,
                })
              }
            }
          }
        } catch (error) {
          console.error(`[App] Failed to process pods in namespace ${namespace}:`, error)
        }
      }

      console.log(`[App] Setting up ${podPortForwards.length} pod port forwards`)
      
      // 3. 각 Pod 포트에 대해 포트포워딩 시작
      for (const forward of podPortForwards) {
        try {
          // 로컬 포트는 Pod 포트와 동일하게 사용
          const localPort = forward.podPort

          // 포트포워딩 시작
          const result = await startPortForward(
            forward.context,
            forward.namespace,
            forward.podName,
            localPort,
            forward.podPort
          )
          
          if (!result || !result.pid || !result.localPort) {
            console.error(`[App] Failed to start port forward for ${forward.podName}:${forward.podPort}`)
            continue
          }
          
          const pid = result.pid
          const actualLocalPort = result.localPort

          // URL 생성 (Service가 있으면 Service URL, 없으면 Pod 기반 URL)
          let domain: string
          if (forward.serviceName && forward.servicePort !== undefined) {
            domain = generateServiceUrl(forward.serviceName, forward.namespace, forward.podPort)
          } else {
            // Pod 정보에서 deployment 이름 찾기
            if (!forward.namespace || forward.namespace.trim() === '') {
              console.warn(`[App] Namespace is empty for pod ${forward.podName}, using pod name as deployment`)
              domain = generateDomain(forward.podName, 'default')
            } else {
              try {
                const pods = await getPods(forward.context, forward.namespace)
                const pod = pods.find(p => p.name === forward.podName)
                const deploymentName = pod?.deployment || forward.podName
                domain = generateDomain(deploymentName, forward.namespace)
              } catch (error) {
                console.error(`[App] Failed to get pods for namespace ${forward.namespace}:`, error)
                domain = generateDomain(forward.podName, forward.namespace || 'default')
              }
            }
          }

          // PortForwardConfig 생성
          const configKey = `${forward.context}:${forward.namespace}:${forward.podName}`
          const config: PortForwardConfig = {
            id: `${configKey}:${forward.podPort}`,
            context: forward.context,
            namespace: forward.namespace,
            pod: forward.podName,
            localPort: actualLocalPort, // 실제 할당된 포트 사용
            remotePort: forward.podPort,
            pid,
            active: true,
            domain,
          }

          // portForwards 상태 업데이트
          setPortForwards(prev => {
            const newMap = new Map(prev)
            if (!newMap.has(forward.context)) {
              newMap.set(forward.context, new Map())
            }
            const contextMap = newMap.get(forward.context)!
            if (!contextMap.has(forward.namespace)) {
              contextMap.set(forward.namespace, new Map())
            }
            const namespaceMap = contextMap.get(forward.namespace)!
            if (!namespaceMap.has(forward.podName)) {
              namespaceMap.set(forward.podName, new Map())
            }
            const podMap = namespaceMap.get(forward.podName)!
            podMap.set(forward.podPort, config)
            return newMap
          })
        } catch (error) {
          console.error(`[App] Failed to start port forward for ${forward.podName}:${forward.podPort}:`, error)
        }
      }

      console.log(`[App] Pod port forwards setup completed`)
    } catch (error) {
      console.error('[App] Failed to setup pod port forwards:', error)
    }
  }, [isHttpPort, startPortForward, fetchNamespaces])

  // 선택된 네임스페이스의 Pod와 Service를 로드 (병렬 처리)
  const loadPodsForNamespaces = useCallback(async (context: string, namespaceNames: string[], setLoadingState: boolean = true) => {
    if (namespaceNames.length === 0) {
      setPodsByNamespace(new Map())
      return
    }

    if (setLoadingState) {
      setLoading(true)
    }
    try {
      // 병렬로 모든 네임스페이스의 Pod와 Service 로드
      // 이미 로드된 네임스페이스도 포함하여 최신 데이터로 갱신
      const promises = namespaceNames
        .filter(namespace => namespace && namespace.trim() !== '') // 빈 namespace 필터링
        .map(async (namespace) => {
          try {
            const [pods, services] = await Promise.all([
              fetchPods(context, namespace),
              getServices(context, namespace).catch(error => {
                console.error(`Failed to load services for namespace ${namespace}:`, error)
                return []
              })
            ])
            return { namespace, pods, services }
          } catch (error) {
            console.error(`Failed to load pods for namespace ${namespace}:`, error)
            return { namespace, pods: [], services: [] }
          }
        })

      const results = await Promise.all(promises)
      
      // 기존 Pod 데이터와 병합
      setPodsByNamespace(prev => {
        const newMap = new Map(prev)
        results.forEach(({ namespace, pods }) => {
          newMap.set(namespace, pods)
        })
        return newMap
      })

      // Service 정보 저장
      setServicesByContextAndNamespace(prev => {
        const newMap = new Map(prev)
        if (!newMap.has(context)) {
          newMap.set(context, new Map())
        }
        const contextMap = newMap.get(context)!
        results.forEach(({ namespace, services }) => {
          contextMap.set(namespace, services)
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

  const loadDataForContext = useCallback(async (context: string) => {
    setLoading(true)
    setError(null)
    try {
      // 네임스페이스 로드
      const loadedNamespaces = await fetchNamespaces(context)
      setNamespaces(loadedNamespaces)
      
      // namespacesByContext 업데이트
      setNamespacesByContext(prev => {
        const newMap = new Map(prev)
        newMap.set(context, loadedNamespaces)
        return newMap
      })
      
      // 제외할 namespace 제외
      const availableNamespaces = loadedNamespaces
        .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
        .map(ns => ns.name)
      
      // 저장된 선택 상태를 복원 (없으면 빈 Set으로 초기화)
      // 함수형 업데이트를 사용하여 최신 상태를 읽고 업데이트
      let validVisibleNamespaces: Set<string> = new Set()
      setVisibleNamespacesByContext(prev => {
        const savedVisibleNamespaces = prev.get(context)
        
        if (savedVisibleNamespaces && savedVisibleNamespaces.size > 0) {
          // 저장된 선택 상태가 있으면 유효한 것만 필터링
          validVisibleNamespaces = new Set<string>()
          for (const ns of savedVisibleNamespaces) {
            if (availableNamespaces.includes(ns)) {
              validVisibleNamespaces.add(ns)
            }
          }
        } else {
          // 저장된 선택 상태가 없으면 빈 Set으로 초기화 (자동 선택 안함)
          validVisibleNamespaces = new Set()
        }
        
        // 유효한 선택 상태를 저장
        const newMap = new Map(prev)
        newMap.set(context, validVisibleNamespaces)
        return newMap
      })

      // 선택된 네임스페이스의 Pod를 로드
      if (validVisibleNamespaces.size > 0) {
        // 유효한 namespace만 필터링하여 전달
        const validNamespaceArray = Array.from(validVisibleNamespaces).filter(
          ns => ns && typeof ns === 'string' && ns.trim() !== ''
        )
        if (validNamespaceArray.length > 0) {
          await loadPodsForNamespaces(context, validNamespaceArray, false)
        } else {
          setPodsByNamespace(new Map())
        }
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
  }, [fetchNamespaces, loadPodsForNamespaces])

  // 캐시 비우기 함수 (전체)
  const clearCache = useCallback(() => {
    setNamespacesByContext(new Map())
    setServicesByContextAndNamespace(new Map())
    setPodsByNamespace(new Map())
    console.log('[App] Cleared all cache')
  }, [])

  // Namespace 캐시 비우기
  const clearNamespaceCache = useCallback(() => {
    setNamespacesByContext(new Map())
    console.log('[App] Cleared namespace cache')
  }, [])

  // Service 캐시 비우기
  const clearServiceCache = useCallback(() => {
    setServicesByContextAndNamespace(new Map())
    console.log('[App] Cleared service cache')
  }, [])

  // Pod 캐시 비우기
  const clearPodCache = useCallback(() => {
    setPodsByNamespace(new Map())
    console.log('[App] Cleared pod cache')
  }, [])

  const handleRefresh = async (context: string) => {
    setRefreshing(true)
    setActiveContext(context)
    try {
      // 캐시 비우기
      clearCache()
      
      // 현재 선택된 네임스페이스를 가져옴
      const currentSelectedNamespaces = getVisibleNamespacesForContext(context)
      
      // 네임스페이스 목록만 새로고침 (선택은 유지)
      setLoading(true)
      setError(null)
      try {
        const loadedNamespaces = await fetchNamespaces(context)
        setNamespaces(loadedNamespaces)
        
        // namespacesByContext 업데이트
        setNamespacesByContext(prev => {
          const newMap = new Map(prev)
          newMap.set(context, loadedNamespaces)
          return newMap
        })
        
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
    // Context가 변경되면 해당 Context의 데이터 로드
    if (!namespacesByContext.has(context)) {
      loadDataForContext(context)
    }
  }

  const handleToggleContext = (context: string) => {
    setExpandedContexts(prev => {
      const newSet = new Set<string>()
      // 이미 열려있는 컨텍스트면 닫고, 아니면 해당 컨텍스트만 열기
      if (!prev.has(context)) {
        newSet.add(context)
        // 확장 시 activeContext 설정 및 데이터 로드 (포트포워딩은 시작하지 않음)
        setActiveContext(context)
        if (!namespacesByContext.has(context)) {
          loadDataForContext(context)
        }
      }
      return newSet
    })
  }

  const handleToggleNamespace = (context: string, namespace: string) => {
    setVisibleNamespacesByContext(prev => {
      const newMap = new Map(prev)
      const currentSet = newMap.get(context) || new Set<string>()
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
        loadPodsForNamespaces(context, [namespace])
      }
      
      newMap.set(context, newSet)
      return newMap
    })
  }

  const handleSelectAllNamespaces = (context: string) => {
    const namespaces = namespacesByContext.get(context) || []
    const availableNamespaces = namespaces
      .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
      .map(ns => ns.name)
    
    setVisibleNamespacesByContext(prev => {
      const newMap = new Map(prev)
      newMap.set(context, new Set(availableNamespaces))
      return newMap
    })
    
    // 선택된 모든 네임스페이스의 Pod 병렬 로드
    loadPodsForNamespaces(context, availableNamespaces)
  }

  const handleDeselectAllNamespaces = (context: string) => {
    setVisibleNamespacesByContext(prev => {
      const newMap = new Map(prev)
      newMap.set(context, new Set())
      return newMap
    })
    setPodsByNamespace(new Map())
  }

  const handleSelectOnlyNamespace = (context: string, namespace: string) => {
    setVisibleNamespacesByContext(prev => {
      const newMap = new Map(prev)
      newMap.set(context, new Set([namespace]))
      return newMap
    })
    // 선택된 네임스페이스의 Pod만 로드
    loadPodsForNamespaces(context, [namespace])
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

  // 컨텍스트 변경 시 네임스페이스 및 Pod 로드 (포트포워딩은 시작하지 않음)
  // useEffect(() => {
  //   if (activeContext) {
  //     loadDataForContext(activeContext)
  //   }
  // }, [activeContext, loadDataForContext])

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
              // 프록시 서버 라우팅 테이블에는 Service URL 전체 사용 (포트 포함)
              activeRoutes.set(config.domain, config.localPort)
              // hosts 파일에는 포트 없이 등록
              const hostsDomain = extractHostsDomain(config.domain)
              if (!activeDomains.includes(hostsDomain)) {
                activeDomains.push(hostsDomain)
              }
            }
          }
        }
      }
    }

    // 프록시 서버 시작 (활성 포트포워딩이 있고 서버가 실행 중이 아니면)
    // ref를 사용하여 최신 값을 읽어서 의존성 배열에서 제거
    const currentProxyPort = proxyServerPortRef.current
    if (activeRoutes.size > 0 && !currentProxyPort) {
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
    if (activeRoutes.size > 0 && currentProxyPort) {
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
      const lastDomains = lastHostsDomainsRef.current
      const domainsChanged = 
        activeDomains.length !== lastDomains.length ||
        activeDomains.some((domain, index) => domain !== lastDomains[index]) ||
        lastDomains.some((domain, index) => domain !== activeDomains[index])
      
      if (domainsChanged) {
        try {
          console.log('[App] Attempting to update hosts file with domains:', activeDomains)
          const result = await window.electronAPI.updateHostsDomains(activeDomains)
          if (result && result.success) {
            lastHostsDomainsRef.current = activeDomains
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
      if (lastHostsDomainsRef.current.length > 0) {
        lastHostsDomainsRef.current = []
      }
    }

    // 모든 포트포워딩이 비활성화되면 프록시 서버 종료
    if (activeRoutes.size === 0 && currentProxyPort) {
      try {
        await window.electronAPI.stopProxyServer()
        setProxyServerPort(null)
      } catch (error) {
        console.error('Failed to stop proxy server:', error)
      }
    }
  }, [portForwards, enableHostsModification])

  // portForwards 변경 시 프록시 서버와 hosts 파일 자동 업데이트 (debounce 적용)
  useEffect(() => {
    // electronAPI가 준비될 때까지 대기
    if (!window.electronAPI) {
      const checkAPI = setInterval(() => {
        if (window.electronAPI) {
          clearInterval(checkAPI)
          // debounce: 500ms 후에 실행
          const timeoutId = setTimeout(() => {
            updateProxyAndHosts()
          }, 500)
          return () => clearTimeout(timeoutId)
        }
      }, 100)
      return () => clearInterval(checkAPI)
    }
    // debounce: 500ms 후에 실행 (빈번한 업데이트 방지)
    const timeoutId = setTimeout(() => {
      updateProxyAndHosts()
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [portForwards, updateProxyAndHosts])

  const handlePortForwardChange = useCallback(async (
    context: string,
    serviceName: string,
    namespace: string,
    targetPort: number | string,
    enabled: boolean
  ) => {
    // Service 찾기 (포트포워딩 해제 시에는 config의 context 사용)
    const contextServices = servicesByContextAndNamespace.get(context)
    if (!contextServices) {
      console.error('No services found for context:', context)
      return
    }

    const namespaceServices = contextServices.get(namespace) || []
    const service = namespaceServices.find(s => s.name === serviceName && s.type === 'ClusterIP')
    
    if (!service) {
      console.error('Service not found:', serviceName)
      alert('Service not found')
      return
    }

    if (enabled) {
      // Service의 selector로 Pod 찾기
      let matchedPod: Pod | undefined
      const namespacePods = podsByNamespace.get(namespace) || []
      
      if (service.selector) {
        const matchingPods: Pod[] = []
        for (const pod of namespacePods) {
          if (!pod.labels || pod.status.toLowerCase() === 'failed') continue
          
          let matches = true
          for (const [key, value] of Object.entries(service.selector)) {
            if (pod.labels[key] !== value) {
              matches = false
              break
            }
          }
          
          if (matches) {
            matchingPods.push(pod)
          }
        }

        // 최신 Pod 선택
        if (matchingPods.length > 0) {
          const sortedPods = [...matchingPods].sort((a, b) => {
            const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
            const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
            return bTime - aTime // 최신이 먼저
          })
          matchedPod = sortedPods[0]
        }
      }

      if (!matchedPod) {
        alert('No matching Pod found for this Service')
        return
      }

      // targetPort를 Pod의 실제 포트 번호로 변환
      let remotePort: number
      if (typeof targetPort === 'number') {
        remotePort = targetPort
      } else {
        // targetPort가 문자열인 경우 Pod 포트 이름으로 찾기
        const podPort = matchedPod.ports.find(p => p.name === targetPort)
        if (!podPort) {
          alert(`Port ${targetPort} not found on Pod`)
          return
        }
        remotePort = podPort.containerPort
      }

      const podName = matchedPod.name
      const configKey = `${context}:${namespace}:${podName}`

      // Service 기반 URL 생성 (Service Port 사용)
      // Service에서 해당 targetPort를 가진 포트 찾기
      const servicePort = service.ports.find(sp => {
        const tp = sp.targetPort
        return (typeof tp === 'number' && tp === targetPort) ||
               (typeof tp === 'string' && matchedPod.ports.find(p => p.name === tp)?.containerPort === targetPort)
      })?.port || service.ports[0]?.port || 80
      
      const domain = generateServiceUrl(serviceName, namespace, servicePort)

      // 로컬 포트 찾기 (사용 가능한 포트)
      const availablePort = findAvailablePort(remotePort, activeLocalPorts)
      if (!availablePort) {
        alert('No available port found')
        return
      }
      const localPort = availablePort

      // 포트포워딩 시작
      try {
        const result = await startPortForward(
          context,
          namespace,
          podName,
          localPort,
          remotePort
        )

        if (!result || !result.pid || !result.localPort) {
          throw new Error('포트포워딩 시작 실패')
        }

        const config: PortForwardConfig = {
          id: `${configKey}:${remotePort}`,
          context,
          namespace,
          pod: podName,
          localPort: result.localPort,
          remotePort,
          pid: result.pid,
          active: true,
          domain,
        }

        setPortForwards(prev => {
          const newMap = new Map(prev)
          if (!newMap.has(context)) {
            newMap.set(context, new Map())
          }
          const contextMap = newMap.get(context)!
          if (!contextMap.has(namespace)) {
            contextMap.set(namespace, new Map())
          }
          const namespaceMap = contextMap.get(namespace)!
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
      // 포트포워딩 중지 - Service의 selector로 Pod 찾기
      let matchedPod: Pod | undefined
      const namespacePods = podsByNamespace.get(namespace) || []
      
      if (service.selector) {
        const matchingPods: Pod[] = []
        for (const pod of namespacePods) {
          if (!pod.labels || pod.status.toLowerCase() === 'failed') continue
          
          let matches = true
          for (const [key, value] of Object.entries(service.selector)) {
            if (pod.labels[key] !== value) {
              matches = false
              break
            }
          }
          
          if (matches) {
            matchingPods.push(pod)
          }
        }

        if (matchingPods.length > 0) {
          const sortedPods = [...matchingPods].sort((a, b) => {
            const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
            const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
            return bTime - aTime
          })
          matchedPod = sortedPods[0]
        }
      }

      if (!matchedPod) {
        console.error('No matching Pod found for service:', serviceName)
        return
      }

      // targetPort를 Pod의 실제 포트 번호로 변환
      let remotePort: number
      if (typeof targetPort === 'number') {
        remotePort = targetPort
      } else {
        const podPort = matchedPod.ports.find(p => p.name === targetPort)
        if (!podPort) {
          console.error(`Port ${targetPort} not found on Pod`)
          return
        }
        remotePort = podPort.containerPort
      }

      const podName = matchedPod.name
      const contextMap = portForwards.get(context)
      const namespaceMap = contextMap?.get(namespace)
      const podMap = namespaceMap?.get(podName)
      const config = podMap?.get(remotePort)

      if (config?.pid) {
        try {
          await stopPortForward(config.pid)
          
          setPortForwards(prev => {
            const newMap = new Map(prev)
            const ctxMap = newMap.get(context)
            const nsMap = ctxMap?.get(namespace)
            const pMap = nsMap?.get(podName)
            if (pMap) {
              pMap.delete(remotePort)
              if (pMap.size === 0) {
                nsMap?.delete(podName)
                if (nsMap?.size === 0) {
                  ctxMap?.delete(namespace)
                  if (ctxMap?.size === 0) {
                    newMap.delete(context)
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
  }, [activeContext, podsByNamespace, portForwards, servicesByContextAndNamespace, activeLocalPorts, findAvailablePort, startPortForward, stopPortForward])

  // HTTP 포트인지 확인하는 함수
  const isHttpServicePort = useCallback((servicePort: Service['ports'][0]): boolean => {
    // grpc 포트는 제외
    if (servicePort.name && servicePort.name.toLowerCase().includes('grpc')) {
      return false
    }
    // Service 포트 이름에 "http"가 포함되어 있는지 확인 (대소문자 무시)
    if (servicePort.name && servicePort.name.toLowerCase().includes('http')) {
      return true
    }
    // 포트 이름이 없거나 "http"가 포함되지 않았지만, 포트 번호가 80이면 HTTP로 간주
    if (servicePort.port === 80) {
      return true
    }
    return false
  }, [])

  // 모든 서비스에 포트포워딩 활성화
  const handleAllForward = useCallback(async (context: string) => {
    // 이미 진행 중이면 무시
    if (allForwarding.has(context)) {
      return
    }

    try {
      setAllForwarding(prev => new Set(prev).add(context))
      
      // 해당 context의 모든 namespace 가져오기
      let allNamespaces = namespacesByContext.get(context) || []
      if (allNamespaces.length === 0) {
        // namespace가 없으면 로드 시도
        const namespaces = await fetchNamespaces(context)
        if (namespaces.length === 0) {
          alert('No namespaces found for this context')
          setAllForwarding(prev => {
            const next = new Set(prev)
            next.delete(context)
            return next
          })
          return
        }
        allNamespaces = namespaces
      }

      // 모든 namespace의 services와 pods 로드
      const namespaceNames = allNamespaces.map(ns => ns.name)
      await loadPodsForNamespaces(context, namespaceNames, false)
      
      // 각 namespace의 services와 pods 가져오기
      const forwardPromises: Promise<void>[] = []
      
      for (const namespace of allNamespaces) {
        // 이미 로드된 services와 pods 사용
        const contextServices = servicesByContextAndNamespace.get(context)
        const namespaceServices = contextServices?.get(namespace.name) || []
        const namespacePods = podsByNamespace.get(namespace.name) || []

        for (const service of namespaceServices) {
          // ClusterIP 타입만 허용
          if (service.type !== 'ClusterIP') {
            continue
          }

          // HTTP 포트 찾기
          const httpPort = service.ports.find(isHttpServicePort)
          if (!httpPort) {
            continue
          }

          // 이미 포트포워딩 중인지 확인
          const contextMap = portForwards.get(context)
          const namespaceMap = contextMap?.get(namespace.name)
          let isAlreadyForwarded = false
          if (namespaceMap && service.selector) {
            for (const pod of namespacePods) {
              if (!pod.labels) continue
              let matches = true
              for (const [key, value] of Object.entries(service.selector)) {
                if (pod.labels[key] !== value) {
                  matches = false
                  break
                }
              }
              if (matches) {
                const podMap = namespaceMap.get(pod.name)
                if (podMap) {
                  const targetPort = typeof httpPort.targetPort === 'number' 
                    ? httpPort.targetPort 
                    : (pod.ports.find(p => p.name === httpPort.targetPort)?.containerPort || 0)
                  const existingForward = podMap.get(targetPort)
                  if (existingForward?.active) {
                    isAlreadyForwarded = true
                    break
                  }
                }
              }
            }
          }

          if (isAlreadyForwarded) {
            continue
          }

          // Service의 selector로 Pod 찾기
          if (!service.selector) {
            continue
          }

          const matchingPods: Pod[] = []
          for (const pod of namespacePods) {
            if (!pod.labels || pod.status.toLowerCase() === 'failed') continue
            
            let matches = true
            for (const [key, value] of Object.entries(service.selector)) {
              if (pod.labels[key] !== value) {
                matches = false
                break
              }
            }
            
            if (matches) {
              matchingPods.push(pod)
            }
          }

          if (matchingPods.length === 0) {
            continue
          }

          // 최신 Pod 선택
          const sortedPods = [...matchingPods].sort((a, b) => {
            const aTime = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0
            const bTime = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0
            return bTime - aTime // 최신이 먼저
          })
          const matchedPod = sortedPods[0]

          // targetPort를 Pod의 실제 포트 번호로 변환
          let remotePort: number
          if (typeof httpPort.targetPort === 'number') {
            remotePort = httpPort.targetPort
          } else {
            const podPort = matchedPod.ports.find(p => p.name === httpPort.targetPort)
            if (!podPort) {
              continue
            }
            remotePort = podPort.containerPort
          }

          // 포트포워딩 시작
          forwardPromises.push(
            handlePortForwardChange(
              context,
              service.name,
              namespace.name,
              httpPort.targetPort,
              true
            ).catch(error => {
              console.error(`Failed to forward ${service.name} in ${namespace.name}:`, error)
            })
          )
        }
      }

      await Promise.all(forwardPromises)
    } catch (error) {
      console.error('Failed to forward all services:', error)
      alert(`Failed to forward all services: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAllForwarding(prev => {
        const next = new Set(prev)
        next.delete(context)
        return next
      })
    }
  }, [allForwarding, namespacesByContext, servicesByContextAndNamespace, podsByNamespace, portForwards, isHttpServicePort, handlePortForwardChange, fetchNamespaces, loadPodsForNamespaces])


  // 포트포워딩 중인 Pod의 namespace를 자동으로 로드
  useEffect(() => {
    const namespacesToLoad = new Set<{ context: string; namespace: string }>()
    
    // 모든 포트포워딩 중인 Pod의 namespace 수집 (Map 기반 조회로 최적화)
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
          if (hasActivePortForward) {
            // 해당 namespace의 Pod가 로드되지 않았으면 로드 목록에 추가 (Map 기반 조회)
            const podInfo = podsByNameMap.get(podName)
            if (!podInfo || podInfo.namespace !== namespace) {
              namespacesToLoad.add({ context, namespace })
            }
            // Service도 로드되지 않았으면 로드 목록에 추가
            const contextServices = servicesByContextAndNamespace.get(context)
            const namespaceServices = contextServices?.get(namespace) || []
            if (namespaceServices.length === 0) {
              namespacesToLoad.add({ context, namespace })
            }
          }
        }
      }
    }
    
    // 필요한 namespace의 Pod와 Service 로드
    for (const { context, namespace } of namespacesToLoad) {
      // 이미 로드 중이거나 로드된 namespace는 건너뛰기
      const existingPods = podsByNamespace.get(namespace)
      const contextServices = servicesByContextAndNamespace.get(context)
      const existingServices = contextServices?.get(namespace) || []
      
      // Pod나 Service가 없으면 로드
      if (!existingPods || existingPods.length === 0 || existingServices.length === 0) {
        loadPodsForNamespaces(context, [namespace], false)
      }
    }
  }, [portForwards, podsByNameMap, podsByNamespace, servicesByContextAndNamespace, loadPodsForNamespaces])

  // 현재 컨텍스트의 보이는 네임스페이스의 Pod 목록 + 포트포워딩 중인 모든 Pod
  const visiblePods = React.useMemo(() => {
    const podSet = new Set<string>() // 중복 방지용
    const allPods: Pod[] = []
    
    if (!activeContext) {
      // activeContext가 없어도 포트포워딩 중인 Pod는 표시 (Map 기반 조회)
      for (const [context, contextMap] of portForwards.entries()) {
        for (const [namespace, namespaceMap] of contextMap.entries()) {
          for (const [podName, podMap] of namespaceMap.entries()) {
            const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
            if (hasActivePortForward) {
              // 포트포워딩 중인 Pod 찾기 (Map 기반 조회)
              const podInfo = podsByNameMap.get(podName)
              if (podInfo && podInfo.namespace === namespace) {
                const key = `${podInfo.namespace}:${podInfo.pod.name}`
                if (!podSet.has(key)) {
                  podSet.add(key)
                  allPods.push(podInfo.pod)
                }
              }
            }
          }
        }
      }
      return allPods
    }
    
    const visibleNamespaces = getVisibleNamespacesForContext(activeContext)
    
    // 선택된 namespace의 Pod 추가
    for (const namespace of visibleNamespaces) {
      const pods = podsByNamespace.get(namespace) || []
      for (const pod of pods) {
        const key = `${pod.namespace}:${pod.name}`
        if (!podSet.has(key)) {
          podSet.add(key)
          allPods.push(pod)
        }
      }
    }
    
    // 포트포워딩 중인 모든 Pod 추가 (다른 context의 것도 포함, Map 기반 조회)
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
          if (hasActivePortForward) {
            const podInfo = podsByNameMap.get(podName)
            if (podInfo && podInfo.namespace === namespace) {
              const key = `${podInfo.namespace}:${podInfo.pod.name}`
              if (!podSet.has(key)) {
                podSet.add(key)
                allPods.push(podInfo.pod)
              }
            }
          }
        }
      }
    }
    
    return allPods
  }, [activeContext, visibleNamespacesByContext, podsByNamespace, podsByNameMap, portForwards, getVisibleNamespacesForContext])

  // 모든 포트포워딩 맵 (Pod 이름 -> 포트 번호 -> 설정) - 모든 context 포함
  const currentPortForwards = React.useMemo(() => {
    const result = new Map<string, Map<number, PortForwardConfig>>()
    
    // 모든 context의 포트포워딩 수집
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          // 이미 있는 Pod면 병합, 없으면 추가
          if (!result.has(podName)) {
            result.set(podName, new Map(podMap))
          } else {
            const existingMap = result.get(podName)!
            for (const [port, config] of podMap.entries()) {
              existingMap.set(port, config)
            }
          }
        }
      }
    }
    
    return result
  }, [portForwards])

  // 현재 컨텍스트의 선택된 namespace의 Service 목록 + 포트포워딩 중인 모든 Service
  const currentServices = React.useMemo(() => {
    const allServices: Array<Service & { context?: string }> = []
    const serviceSet = new Set<string>() // 중복 방지용 (context:namespace:service)
    
    if (activeContext) {
      const contextServices = servicesByContextAndNamespace.get(activeContext)
      if (contextServices) {
        const visibleNamespaces = getVisibleNamespacesForContext(activeContext)
        
        // 선택된 namespace의 services 포함
        for (const namespace of visibleNamespaces) {
          const services = contextServices.get(namespace) || []
          for (const service of services) {
            const key = `${activeContext}:${namespace}:${service.name}`
            if (!serviceSet.has(key)) {
              serviceSet.add(key)
              allServices.push({ ...service, context: activeContext })
            }
          }
        }
      }
    }
    
    // 포트포워딩 중인 Pod의 Service 찾아서 추가 (다른 context/namespace에 있어도)
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
          if (hasActivePortForward) {
            // 포트포워딩 중인 Pod 찾기
            const podInfo = podsByNameMap.get(podName)
            if (podInfo && podInfo.namespace === namespace) {
              // 해당 context의 services에서 Pod의 labels와 매칭되는 서비스 찾기
              const contextServices = servicesByContextAndNamespace.get(context)
              let foundService = false
              if (contextServices && podInfo.pod.labels) {
                const namespaceServices = contextServices.get(namespace) || []
                for (const service of namespaceServices) {
                  // Service의 selector로 Pod 매칭 확인
                  if (service.selector) {
                    let matches = true
                    for (const [key, value] of Object.entries(service.selector)) {
                      if (podInfo.pod.labels![key] !== value) {
                        matches = false
                        break
                      }
                    }
                    if (matches) {
                      const serviceKey = `${context}:${namespace}:${service.name}`
                      if (!serviceSet.has(serviceKey)) {
                        serviceSet.add(serviceKey)
                        allServices.push({ ...service, context })
                        foundService = true
                      }
                    }
                  }
                }
              }
              
              // Service를 찾지 못했지만 포트포워딩이 활성화되어 있으면 Service를 로드 시도
              if (!foundService) {
                loadPodsForNamespaces(context, [namespace], false).catch(error => {
                  console.error(`Failed to load services for ${namespace} in ${context}:`, error)
                })
              }
            }
          }
        }
      }
    }
    
    return allServices
  }, [activeContext, servicesByContextAndNamespace, visibleNamespacesByContext, portForwards, podsByNameMap, getVisibleNamespacesForContext])

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
        // 포트포워딩 정보에서 config 찾기
        const contextMap = portForwards.get(item.context)
        const namespaceMap = contextMap?.get(item.namespace)
        const podMap = namespaceMap?.get(item.podName)
        const config = podMap?.get(item.remotePort)

        if (config?.pid) {
          await stopPortForward(config.pid)
          
          setPortForwards(prev => {
            const newMap = new Map(prev)
            const ctxMap = newMap.get(item.context)
            const nsMap = ctxMap?.get(item.namespace)
            const pMap = nsMap?.get(item.podName)
            if (pMap) {
              pMap.delete(item.remotePort)
              if (pMap.size === 0) {
                nsMap?.delete(item.podName)
                if (nsMap?.size === 0) {
                  ctxMap?.delete(item.namespace)
                  if (ctxMap?.size === 0) {
                    newMap.delete(item.context)
                  }
                }
              }
            }
            return newMap
          })
        }
      } catch (error) {
        console.error(`Failed to disable port forward for ${item.podName}:${item.remotePort}`, error)
      }
    }
  }, [portForwards, activeContext, handleContextChange, stopPortForward])

  // GNB용 새로고침 핸들러
  const handleRefreshForGNB = useCallback(() => {
    if (activeContext) {
      handleRefresh(activeContext)
    }
  }, [activeContext, handleRefresh])

  return (
    <div className="app">
      <GlobalNavBar
        activeContext={activeContext}
        onClearAllCache={clearCache}
        onClearNamespaceCache={clearNamespaceCache}
        onClearServiceCache={clearServiceCache}
        onClearPodCache={clearPodCache}
        onRefresh={handleRefreshForGNB}
        refreshing={refreshing}
      />
      <div className="app-content">
        <ContextTree
          contexts={contexts}
          namespacesByContext={namespacesByContext}
          visibleNamespacesByContext={visibleNamespacesByContext}
          expandedContexts={expandedContexts}
          portForwards={portForwards}
          onToggleContext={handleToggleContext}
          onToggleNamespace={handleToggleNamespace}
          onSelectAllNamespaces={handleSelectAllNamespaces}
          onDeselectAllNamespaces={handleDeselectAllNamespaces}
          onSelectOnlyNamespace={handleSelectOnlyNamespace}
          onRefresh={handleRefresh}
          onAllForward={handleAllForward}
          refreshing={refreshing}
          allForwarding={allForwarding}
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
              services={currentServices}
              onPortForwardChange={handlePortForwardChange}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default App

