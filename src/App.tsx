import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PodList } from './components/PodList'
import { GlobalNavBar } from './components/GlobalNavBar'
import { Notification } from './components/Notification'
import { useKubectl } from './hooks/useKubectl'
import { usePortForward } from './hooks/usePortForward'
import { getServices, getPods } from './utils/kubectl'
import { generateServiceUrl, extractHostsDomain, generateDomain } from './utils/domain'
import type { KubernetesContext, Namespace, Pod, PortForwardConfig, Service, ServicePort } from './types'
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
  'opentelemetry-operator-system',
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
  const [allForwardProgress, setAllForwardProgress] = useState<Map<string, { current: number; total: number }>>(new Map())
  const [disablingAll, setDisablingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ successCount: number; failCount: number } | null>(null)
  const [lastAllForwardTime, setLastAllForwardTime] = useState<number>(0) // handleAllForward 완료 시간 추적
  const [isLoadingNamespaces, setIsLoadingNamespaces] = useState(false) // namespace 로딩 중 플래그
  const loadingContextRef = useRef<Set<string>>(new Set()) // 현재 로딩 중인 context 추적
  const lastLoadTimeRef = useRef<Map<string, number>>(new Map()) // context별 마지막 로드 시간 추적 (중복 방지)
  const loadedNamespacesRef = useRef<Set<string>>(new Set()) // 이미 로드된 namespace 추적 (형식: "context:namespace")
  const activePortForwardsCountRef = useRef<number>(0) // 활성 포트포워딩 개수 추적 (변경 감지용)
  const prevPortForwardsRef = useRef<Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>>(new Map()) // 이전 portForwards 상태 추적
  // Context별 전체 조회 캐시 (성능 최적화)
  const allPodsCache = useRef<Map<string, Pod[]>>(new Map()) // context별 전체 Pod 캐시
  const allServicesCache = useRef<Map<string, Service[]>>(new Map()) // context별 전체 Service 캐시
  // podsByNamespace와 servicesByContextAndNamespace를 ref로 추적 (무한 루프 방지)
  const podsByNamespaceRef = useRef<Map<string, Pod[]>>(new Map())
  const servicesByContextAndNamespaceRef = useRef<Map<string, Map<string, Service[]>>>(new Map())
  // loadPodsForNamespaces를 ref로 저장 (무한 루프 방지)
  const loadPodsForNamespacesRef = useRef<typeof loadPodsForNamespaces | null>(null)
  const [proxyServerPort, setProxyServerPort] = useState<number | null>(null)
  const proxyServerPortRef = useRef<number | null>(null)
  const lastHostsDomainsRef = useRef<string[]>([]) // lastHostsDomains를 위한 ref (무한 루프 방지)
  
  // proxyServerPort 변경 시 ref도 업데이트
  useEffect(() => {
    proxyServerPortRef.current = proxyServerPort
  }, [proxyServerPort])

  // loadPodsForNamespaces를 ref에 저장 (무한 루프 방지)
  // 이 useEffect는 loadPodsForNamespaces가 정의된 후에 실행되어야 함
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

  // 선택된 네임스페이스의 Pod와 Service를 로드 (최적화: 전체 조회 후 매핑)
  // 반환값: Map<namespace, { pods: Pod[], services: Service[] }>
  const loadPodsForNamespaces = useCallback(async (context: string, namespaceNames: string[], setLoadingState: boolean = true): Promise<Map<string, { pods: Pod[]; services: Service[] }>> => {
    if (namespaceNames.length === 0) {
      setPodsByNamespace(prev => {
        const newMap = new Map(prev)
        return newMap
      })
      return new Map()
    }

    // 중복 호출 방지: 같은 context가 이미 로딩 중이면 기다림
    if (loadingContextRef.current.has(context)) {
      console.log(`[App] Context ${context} is already loading, skipping duplicate call`)
      return new Map()
    }
    
    loadingContextRef.current.add(context)

    if (setLoadingState) {
      setLoading(true)
    }
    try {
      // 이미 로드된 namespace 필터링 (중복 호출 방지)
      // ref를 사용하여 최신 상태 읽기 (무한 루프 방지)
      const currentPodsByNamespace = podsByNamespaceRef.current
      const currentServicesByContextAndNamespace = servicesByContextAndNamespaceRef.current
      
      // 중복 제거 및 유효성 검사
      const uniqueNamespaces = Array.from(new Set(namespaceNames.filter(ns => ns && ns.trim() !== '')))
      
      const namespacesToLoad = uniqueNamespaces.filter(namespace => {
        // 이미 Pod와 Service가 모두 로드되어 있으면 건너뛰기
        const existingPods = currentPodsByNamespace.get(namespace)
        const contextServices = currentServicesByContextAndNamespace.get(context)
        const namespaceServices = contextServices?.get(namespace) || []
        return !(existingPods && existingPods.length > 0 && namespaceServices.length > 0)
      })

      // 결과를 저장할 Map
      const resultMap = new Map<string, { pods: Pod[]; services: Service[] }>()

      if (namespacesToLoad.length === 0) {
        // 모두 이미 로드되어 있으면 기존 데이터를 반환
        uniqueNamespaces.forEach(namespace => {
          const existingPods = currentPodsByNamespace.get(namespace) || []
          const contextServices = currentServicesByContextAndNamespace.get(context)
          const namespaceServices = contextServices?.get(namespace) || []
          resultMap.set(namespace, { pods: existingPods, services: namespaceServices })
        })
        if (setLoadingState) {
          setLoading(false)
        }
        return resultMap
      }

      // 최적화: 전체 Pod와 Service를 한 번에 조회한 후 애플리케이션에서 매핑
      // 캐시를 먼저 확인하고, 없으면 전체 조회 후 캐시에 저장
      let allPodsResult: { success: boolean; pods: any[]; error: string | null } = { success: false, pods: [], error: null }
      let allServicesResult: { success: boolean; services: any[]; error: string | null } = { success: false, services: [], error: null }
      
      // 캐시 확인
      const cachedPods = allPodsCache.current.get(context)
      const cachedServices = allServicesCache.current.get(context)
      
      if (cachedPods && cachedServices) {
        // 캐시에 있으면 사용
        allPodsResult = { success: true, pods: cachedPods, error: null }
        allServicesResult = { success: true, services: cachedServices, error: null }
        console.log(`[App] Using cached data for context ${context}: ${cachedPods.length} pods, ${cachedServices.length} services`)
      } else {
        // 캐시에 없으면 전체 조회 후 캐시에 저장
        // Service는 전체 조회 시도 (일반적으로 Pod보다 작음)
        try {
          allServicesResult = await (window.electronAPI?.getK8sServicesAll?.(context) || Promise.resolve({ success: false, services: [], error: 'API not available' }))
          if (allServicesResult.success) {
            allServicesCache.current.set(context, allServicesResult.services)
            console.log(`[App] Cached ${allServicesResult.services.length} services for context ${context}`)
          }
        } catch (error: any) {
          console.warn('[App] Failed to load all services, will use namespace-by-namespace fallback:', error.message)
          allServicesResult = { success: false, services: [], error: error.message }
        }
        
        // Pod 전체 조회 시도 (실패 시 namespace별 조회로 fallback)
        try {
          allPodsResult = await (window.electronAPI?.getK8sPodsAll?.(context) || Promise.resolve({ success: false, pods: [], error: 'API not available' }))
          if (allPodsResult.success) {
            allPodsCache.current.set(context, allPodsResult.pods)
            console.log(`[App] Cached ${allPodsResult.pods.length} pods for context ${context}`)
          }
        } catch (error: any) {
          console.warn('[App] Failed to load all pods (response too large?), will use namespace-by-namespace fallback:', error.message)
          allPodsResult = { success: false, pods: [], error: error.message }
        }
      }

      // 전체 Pod와 Service를 namespace별로 매핑
      const podsByNamespaceMap = new Map<string, Pod[]>()
      const servicesByNamespaceMap = new Map<string, Service[]>()

      if (allPodsResult.success) {
        for (const pod of allPodsResult.pods) {
          // 타입 변환: API 응답을 Pod 타입으로 변환
          const podData: Pod = {
            name: pod.name,
            namespace: pod.namespace,
            status: pod.status,
            age: pod.age,
            ports: pod.ports,
            deployment: pod.deployment,
            creationTimestamp: pod.creationTimestamp,
            labels: pod.labels,
            spec: pod.spec,
          }
          if (!podsByNamespaceMap.has(podData.namespace)) {
            podsByNamespaceMap.set(podData.namespace, [])
          }
          podsByNamespaceMap.get(podData.namespace)!.push(podData)
        }
      }

      if (allServicesResult.success) {
        for (const service of allServicesResult.services) {
          // 타입 변환: API 응답을 Service 타입으로 변환
          const serviceData: Service = {
            name: service.name,
            namespace: service.namespace,
            type: service.type,
            clusterIP: service.clusterIP,
            ports: service.ports,
            selector: service.selector,
          }
          if (!servicesByNamespaceMap.has(serviceData.namespace)) {
            servicesByNamespaceMap.set(serviceData.namespace, [])
          }
          servicesByNamespaceMap.get(serviceData.namespace)!.push(serviceData)
        }
      }

      // Pod 전체 조회가 실패한 경우 namespace별 조회로 fallback
      const missingPodNamespaces = namespacesToLoad.filter(ns => !podsByNamespaceMap.has(ns) || podsByNamespaceMap.get(ns)!.length === 0)
      if (missingPodNamespaces.length > 0 && !allPodsResult.success) {
        console.log(`[App] Loading pods for ${missingPodNamespaces.length} namespaces individually (fallback)`)
        // 배치 처리로 namespace별 Pod 조회 (동시 요청 수 제한)
        const POD_BATCH_SIZE = 5
        for (let i = 0; i < missingPodNamespaces.length; i += POD_BATCH_SIZE) {
          const batch = missingPodNamespaces.slice(i, i + POD_BATCH_SIZE)
          const batchPromises = batch.map(async (namespace) => {
        try {
          const pods = await fetchPods(context, namespace)
          return { namespace, pods }
        } catch (error) {
              console.error(`[App] Failed to load pods for namespace ${namespace}:`, error)
              return { namespace, pods: [] as Pod[] }
            }
          })
          
          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach(({ namespace, pods }) => {
            if (!podsByNamespaceMap.has(namespace)) {
              podsByNamespaceMap.set(namespace, [])
            }
            podsByNamespaceMap.set(namespace, pods)
          })
          
          // 배치 사이에 딜레이
          if (i + POD_BATCH_SIZE < missingPodNamespaces.length) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
      }

      // Service 전체 조회가 실패한 경우 namespace별 조회로 fallback
      const missingServiceNamespaces = namespacesToLoad.filter(ns => !servicesByNamespaceMap.has(ns) || servicesByNamespaceMap.get(ns)!.length === 0)
      if (missingServiceNamespaces.length > 0 && !allServicesResult.success) {
        console.log(`[App] Loading services for ${missingServiceNamespaces.length} namespaces individually (fallback)`)
        // 배치 처리로 namespace별 Service 조회
        const SERVICE_BATCH_SIZE = 5
        for (let i = 0; i < missingServiceNamespaces.length; i += SERVICE_BATCH_SIZE) {
          const batch = missingServiceNamespaces.slice(i, i + SERVICE_BATCH_SIZE)
          const batchPromises = batch.map(async (namespace) => {
            try {
              const services = await getServices(context, namespace).catch(error => {
                console.error(`[App] Failed to load services for namespace ${namespace}:`, error)
                return []
              })
              return { namespace, services }
            } catch (error) {
              console.error(`[App] Failed to load services for namespace ${namespace}:`, error)
              return { namespace, services: [] as Service[] }
            }
          })
          
          const batchResults = await Promise.all(batchPromises)
          batchResults.forEach(({ namespace, services }) => {
            if (!servicesByNamespaceMap.has(namespace)) {
              servicesByNamespaceMap.set(namespace, [])
            }
            servicesByNamespaceMap.set(namespace, services)
          })
          
          // 배치 사이에 딜레이
          if (i + SERVICE_BATCH_SIZE < missingServiceNamespaces.length) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        }
      }

      // 요청한 namespace에 대해 결과 구성
      const results: Array<{ namespace: string; pods: Pod[]; services: Service[] }> = []
      for (const namespace of namespacesToLoad) {
        const pods = podsByNamespaceMap.get(namespace) || []
        const services = servicesByNamespaceMap.get(namespace) || []
        results.push({ namespace, pods, services })
      }
      
      // 결과를 Map에 저장
      results.forEach(({ namespace, pods, services }) => {
        resultMap.set(namespace, { pods, services })
      })
      
      // 기존 Pod 데이터와 병합
      setPodsByNamespace(prev => {
        const newMap = new Map(prev)
        results.forEach(({ namespace, pods }) => {
          newMap.set(namespace, pods)
        })
        // ref도 업데이트
        podsByNamespaceRef.current = newMap
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
        // ref도 업데이트
        servicesByContextAndNamespaceRef.current = newMap
        return newMap
      })

      // 이미 로드된 namespace의 데이터도 결과에 포함
      uniqueNamespaces.forEach(namespace => {
        if (!resultMap.has(namespace)) {
          const existingPods = currentPodsByNamespace.get(namespace) || []
          const contextServices = currentServicesByContextAndNamespace.get(context)
          const namespaceServices = contextServices?.get(namespace) || []
          resultMap.set(namespace, { pods: existingPods, services: namespaceServices })
        }
      })

      return resultMap
    } catch (error) {
      console.error('Failed to load pods:', error)
      return new Map()
    } finally {
      loadingContextRef.current.delete(context)
      if (setLoadingState) {
        setLoading(false)
      }
    }
  }, [fetchPods, getServices])

  // loadPodsForNamespaces를 ref에 저장 (무한 루프 방지)
  useEffect(() => {
    loadPodsForNamespacesRef.current = loadPodsForNamespaces
  }, [loadPodsForNamespaces])

  // 모든 context의 모든 namespace 자동 로드
  useEffect(() => {
    if (contexts.length === 0) {
      return
    }

    // 모든 context의 모든 namespace를 로드
    const loadAllContexts = async () => {
      for (const context of contexts) {
        try {
          // 각 context의 namespace 목록 가져오기
          const namespaces = await fetchNamespaces(context.name)
          if (namespaces && namespaces.length > 0) {
            // 제외할 namespace 필터링
            const availableNamespaces = namespaces
              .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
              .map(ns => ns.name)
            
            if (availableNamespaces.length > 0) {
              // 모든 namespace의 pod와 service 로드
              const loadFn = loadPodsForNamespacesRef.current
              if (loadFn) {
                await loadFn(context.name, availableNamespaces, false)
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load data for context ${context.name}:`, error)
        }
      }
    }

    loadAllContexts()
  }, [contexts, fetchNamespaces])

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
    allPodsCache.current.clear()
    allServicesCache.current.clear()
    console.log('[App] Cleared all cache (including full query cache)')
  }, [])

  // Namespace 캐시 비우기
  const clearNamespaceCache = useCallback(() => {
    setNamespacesByContext(new Map())
    console.log('[App] Cleared namespace cache')
  }, [])

  // Service 캐시 비우기
  const clearServiceCache = useCallback(() => {
    setServicesByContextAndNamespace(new Map())
    allServicesCache.current.clear()
    console.log('[App] Cleared service cache (including full query cache)')
  }, [])

  // Pod 캐시 비우기
  const clearPodCache = useCallback(() => {
    setPodsByNamespace(new Map())
    allPodsCache.current.clear()
    console.log('[App] Cleared pod cache (including full query cache)')
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
              console.log(`[App] Active port forward: ${config.domain} -> localhost:${config.localPort} (hosts: ${hostsDomain})`)
            }
          }
        }
      }
    }
    
    console.log(`[App] Total active routes: ${activeRoutes.size}, domains: ${activeDomains.length}`)

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
        console.log('[App] Updating proxy routes:', routesObj)
        await window.electronAPI.updateProxyRoutes(routesObj)
        console.log('[App] Proxy routes updated successfully')
      } catch (error) {
        console.error('Failed to update proxy routes:', error)
      }
    } else {
      console.log('[App] Skipping proxy route update:', {
        activeRoutesSize: activeRoutes.size,
        currentProxyPort,
      })
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
      let namespacePods = podsByNamespace.get(namespace) || []
      
      // Pod가 없으면 다시 로드 시도
      if (namespacePods.length === 0) {
        console.log(`[handlePortForwardChange] No pods found for namespace ${namespace}, attempting to load...`)
        try {
          const loadFn = loadPodsForNamespacesRef.current
          if (loadFn) {
            await loadFn(context, [namespace], false)
            namespacePods = podsByNamespace.get(namespace) || []
          }
        } catch (error) {
          console.error(`[handlePortForwardChange] Failed to load pods for namespace ${namespace}:`, error)
        }
      }
      
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

      // targetPort를 숫자로 변환
      let remotePort: number
      if (typeof targetPort === 'number') {
        remotePort = targetPort
      } else {
        // targetPort가 문자열인 경우
        if (matchedPod) {
          // Pod가 있으면 Pod 포트 이름으로 찾기
          const podPort = matchedPod.ports.find(p => p.name === targetPort)
          if (!podPort) {
            alert(`Port ${targetPort} not found on Pod ${matchedPod.name}`)
            return
          }
          remotePort = podPort.containerPort
        } else {
          // Pod가 없으면 targetPort를 숫자로 파싱 시도
          const parsedPort = parseInt(targetPort, 10)
          if (isNaN(parsedPort)) {
            alert(`Cannot determine port for service ${serviceName}. Pod not found and targetPort "${targetPort}" is not a number.`)
            return
          }
          remotePort = parsedPort
        }
      }

      // Pod가 없으면 포트포워딩 불가능
      if (!matchedPod) {
        alert(`Cannot port forward to service ${serviceName} in namespace ${namespace}. No matching Pod found. Please ensure the service has running pods.`)
        return
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
    // 포트 이름이 없거나 빈 문자열인 경우 HTTP로 간주 (grpc가 아닌 경우)
    if (!servicePort.name || servicePort.name.trim() === '' || servicePort.name === '<unset>') {
      return true
    }
    // 일반적인 HTTP 포트 번호들도 HTTP로 간주
    const commonHttpPorts = [80, 8080, 3000, 8000, 5000, 4000, 9000]
    if (commonHttpPorts.includes(servicePort.port)) {
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

    // 성공/실패 카운트 (try 블록 밖에서 선언)
    let successCount = 0
    let failCount = 0

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
        // namespacesByContext에도 저장
        setNamespacesByContext(prev => {
          const newMap = new Map(prev)
          newMap.set(context, namespaces)
          return newMap
        })
      }

      // 제외할 namespace 필터링
      const availableNamespaces = allNamespaces
        .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
        .map(ns => ns.name)

      // 컨텍스트를 펼치고 activeContext 설정 (UI에 표시되도록)
      setExpandedContexts(prev => {
        const newSet = new Set(prev)
        newSet.add(context)
        return newSet
      })
      setActiveContext(context)

      // 모든 namespace를 활성화 (visibleNamespacesByContext에 추가)
      setVisibleNamespacesByContext(prev => {
        const newMap = new Map(prev)
        const newSet = new Set<string>()
        availableNamespaces.forEach(ns => newSet.add(ns))
        newMap.set(context, newSet)
        return newMap
      })

      // 모든 namespace의 services와 pods 로드 (한 번만)
      // loadPodsForNamespaces가 반환하는 데이터를 직접 사용
      const loadedData = await loadPodsForNamespaces(context, availableNamespaces, false)
      
      // 포트포워딩할 서비스 목록 수집
      const servicesToForward: Array<{
        context: string
        service: Service
        namespace: string
        httpPort: ServicePort
        pod: Pod
      }> = []
      
      for (const namespace of availableNamespaces) {
        // loadPodsForNamespaces의 반환값에서 직접 가져오기
        const namespaceData = loadedData.get(namespace)
        const namespaceServices = namespaceData?.services || []
        const namespacePods = namespaceData?.pods || []

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
    const namespaceMap = contextMap?.get(namespace)
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

          servicesToForward.push({
            context,
            service,
            namespace: namespace,
            httpPort,
            pod: matchedPod
          })
        }
      }

      // 프로그레스 초기화
      setAllForwardProgress(prev => {
        const next = new Map(prev)
        next.set(context, { current: 0, total: servicesToForward.length })
        return next
      })

      // 순차적으로 포트포워딩 처리 (직접 포트포워딩 시작)
      for (let i = 0; i < servicesToForward.length; i++) {
        const { service, namespace, httpPort, pod } = servicesToForward[i]
        
        // 프로그레스 업데이트 (시작 시)
        setAllForwardProgress(prev => {
          const next = new Map(prev)
          const current = next.get(context)
          if (current) {
            next.set(context, { current: i, total: current.total })
          }
          return next
        })
        
        try {
          // targetPort를 Pod의 실제 포트 번호로 변환
          let remotePort: number
          if (typeof httpPort.targetPort === 'number') {
            remotePort = httpPort.targetPort
          } else {
            const podPort = pod.ports.find(p => p.name === httpPort.targetPort)
            if (!podPort) {
              console.error(`Port ${httpPort.targetPort} not found on Pod ${pod.name}`)
              failCount++
              // 프로그레스 업데이트 (실패 시)
              setAllForwardProgress(prev => {
                const next = new Map(prev)
                const current = next.get(context)
                if (current) {
                  next.set(context, { current: i + 1, total: current.total })
                }
                return next
              })
              continue
            }
            remotePort = podPort.containerPort
          }

          const podName = pod.name
          const configKey = `${context}:${namespace}:${podName}`

          // Service 기반 URL 생성
          const servicePort = httpPort.port || 80
          const domain = generateServiceUrl(service.name, namespace, servicePort)

          // 현재 활성 포트 목록 가져오기 (직접 읽기, 상태 변경 없음)
          const currentActivePorts = new Set<number>()
          for (const [, ctxMap] of portForwards.entries()) {
            for (const [, nsMap] of ctxMap.entries()) {
              for (const [, pMap] of nsMap.entries()) {
                for (const [, config] of pMap.entries()) {
                  if (config.active) {
                    currentActivePorts.add(config.localPort)
                  }
                }
              }
            }
          }

          // 로컬 포트 찾기 (사용 가능한 포트)
          const availablePort = findAvailablePort(remotePort, currentActivePorts)
          if (!availablePort) {
            console.error(`No available port found for ${service.name} in ${namespace}`)
            failCount++
            // 프로그레스 업데이트 (실패 시)
            setAllForwardProgress(prev => {
              const next = new Map(prev)
              const current = next.get(context)
              if (current) {
                next.set(context, { current: i + 1, total: current.total })
              }
              return next
            })
            continue
          }
          const localPort = availablePort

          // 포트포워딩 시작
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

          // portForwards 상태 업데이트
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

          successCount++

          // 프로그레스 업데이트 (성공 시)
          setAllForwardProgress(prev => {
            const next = new Map(prev)
            const current = next.get(context)
            if (current) {
              next.set(context, { current: i + 1, total: current.total })
            }
            return next
          })
          
          // 각 포트포워딩 사이에 짧은 딜레이 (상태 업데이트 안정화)
          await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
          console.error(`Failed to forward ${service.name} in ${namespace}:`, error)
          failCount++
          // 프로그레스 업데이트 (에러 시)
          setAllForwardProgress(prev => {
            const next = new Map(prev)
            const current = next.get(context)
            if (current) {
              next.set(context, { current: i + 1, total: current.total })
            }
            return next
          })
          // 에러가 발생해도 계속 진행
        }
      }
    } catch (error) {
      console.error('Failed to forward all services:', error)
      alert(`Failed to forward all services: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setAllForwarding(prev => {
        const next = new Set(prev)
        next.delete(context)
        return next
      })
      setAllForwardProgress(prev => {
        const next = new Map(prev)
        next.delete(context)
        return next
      })
      
      // 포트포워딩 완료 후 UI 업데이트를 위해 약간의 딜레이
      // updateProxyAndHosts는 useEffect에서 자동으로 호출됨
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // 알림 표시
      if (successCount > 0 || failCount > 0) {
        setNotification({ successCount, failCount })
      }
      
      // handleAllForward 완료 시간 기록 (useEffect 중복 실행 방지)
      setLastAllForwardTime(Date.now())
      
      // all forward 완료 후 로드된 namespace 추적 초기화
      loadedNamespacesRef.current.clear()
      
      // 활성 포트포워딩 개수 업데이트 (handleAllForward가 이미 모든 namespace를 로드했으므로)
      // 다음 useEffect 실행 시 불필요한 로드를 방지
      let activeCount = 0
      for (const [context, contextMap] of portForwards.entries()) {
        for (const [namespace, namespaceMap] of contextMap.entries()) {
          for (const [podName, podMap] of namespaceMap.entries()) {
            for (const [remotePort, pf] of podMap.entries()) {
              if (pf.active) {
                activeCount++
              }
            }
          }
        }
      }
      activePortForwardsCountRef.current = activeCount
      
      // prevPortForwardsRef 업데이트하여 useEffect가 실행되지 않도록 보장
      prevPortForwardsRef.current = new Map(portForwards)
    }
  }, [allForwarding, namespacesByContext, portForwards, isHttpServicePort, startPortForward, fetchNamespaces, loadPodsForNamespaces, findAvailablePort])

  // 포트포워딩 중인 Pod의 namespace를 자동으로 로드
  // handleAllForward가 이미 모든 namespace를 로드하므로, 개별 포트포워딩 시에만 필요
  // portForwards를 dependency에서 제거하고 useRef로 추적하여 불필요한 실행 방지
  useEffect(() => {
    // allForwarding이 진행 중이면 자동 로드 건너뛰기 (handleAllForward가 이미 로드함)
    if (allForwarding.size > 0) {
      // 이전 상태 업데이트 (다음 체크를 위해)
      prevPortForwardsRef.current = new Map(portForwards)
      return
    }
    
    // 이미 로딩 중이면 건너뛰기
    if (isLoadingNamespaces) {
      return
    }

    // handleAllForward 완료 후 10초 동안은 자동 로드 건너뛰기 (중복 호출 방지)
    const timeSinceLastAllForward = Date.now() - lastAllForwardTime
    if (timeSinceLastAllForward < 10000) {
      // 이전 상태 업데이트 (다음 체크를 위해)
      prevPortForwardsRef.current = new Map(portForwards)
      return
    }

    // 이전 상태와 비교하여 실제로 새로운 활성 포트포워딩이 추가되었는지 확인
    const prevPortForwards = prevPortForwardsRef.current
    let hasNewActivePortForward = false
    
    // 현재 활성 포트포워딩 수집
    const currentActiveForwards = new Set<string>()
    for (const [context, contextMap] of portForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          for (const [remotePort, pf] of podMap.entries()) {
            if (pf.active) {
              const key = `${context}:${namespace}:${podName}:${remotePort}`
              currentActiveForwards.add(key)
            }
          }
        }
      }
    }
    
    // 이전 활성 포트포워딩 수집
    const prevActiveForwards = new Set<string>()
    for (const [context, contextMap] of prevPortForwards.entries()) {
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        for (const [podName, podMap] of namespaceMap.entries()) {
          for (const [remotePort, pf] of podMap.entries()) {
            if (pf.active) {
              const key = `${context}:${namespace}:${podName}:${remotePort}`
              prevActiveForwards.add(key)
            }
          }
        }
      }
    }
    
    // 새로운 활성 포트포워딩이 있는지 확인
    for (const key of currentActiveForwards) {
      if (!prevActiveForwards.has(key)) {
        hasNewActivePortForward = true
        break
      }
    }
    
    // 새로운 포트포워딩이 없으면 종료
    if (!hasNewActivePortForward) {
      // 이전 상태 업데이트 (다음 체크를 위해)
      prevPortForwardsRef.current = new Map(portForwards)
      return
    }
    
    // 활성 포트포워딩 개수 업데이트
    activePortForwardsCountRef.current = currentActiveForwards.size

    // 실제로 새로운 포트포워딩이 추가된 경우에만 실행
    // 상태를 변경하지 않고 필요한 namespace만 수집한 후 별도로 처리
    const namespacesToLoad = new Set<{ context: string; namespace: string }>()
    const now = Date.now()
    
    // ref를 사용하여 최신 상태 읽기 (무한 루프 방지)
    const currentPodsByNamespace = podsByNamespaceRef.current
    const currentServicesByContextAndNamespace = servicesByContextAndNamespaceRef.current
    
    // 모든 포트포워딩 중인 Pod의 namespace 수집 (Map 기반 조회로 최적화)
    for (const [context, contextMap] of portForwards.entries()) {
      // context별 마지막 로드 시간 확인 (5초 이내면 건너뛰기)
      const lastLoadTime = lastLoadTimeRef.current.get(context) || 0
      if (now - lastLoadTime < 5000) {
        continue // 이 context는 최근에 로드했으므로 건너뛰기
      }
      
      for (const [namespace, namespaceMap] of contextMap.entries()) {
        const namespaceKey = `${context}:${namespace}`
        
        // 이미 로드된 namespace는 건너뛰기
        if (loadedNamespacesRef.current.has(namespaceKey)) {
          continue
        }
        
        for (const [podName, podMap] of namespaceMap.entries()) {
          const hasActivePortForward = Array.from(podMap.values()).some(pf => pf.active)
          if (hasActivePortForward) {
            // 해당 namespace의 Pod와 Service가 모두 로드되었는지 확인
            const existingPods = currentPodsByNamespace.get(namespace) || []
            const podInfo = existingPods.find(p => p.name === podName)
            const contextServices = currentServicesByContextAndNamespace.get(context)
            const namespaceServices = contextServices?.get(namespace) || []
            
            // Pod와 Service가 모두 있고, podInfo도 정확하면 로드 불필요
            const hasPods = existingPods.length > 0
            const hasServices = namespaceServices.length > 0
            const podInfoMatches = podInfo && podInfo.namespace === namespace
            
            if (!hasPods || !hasServices || !podInfoMatches) {
              namespacesToLoad.add({ context, namespace })
            } else {
              // 이미 로드되었으므로 추적에 추가
              loadedNamespacesRef.current.add(namespaceKey)
            }
          }
        }
      }
    }
    
    // 필요한 namespace가 없으면 종료
    if (namespacesToLoad.size === 0) {
      // 이전 상태 업데이트 (다음 체크를 위해)
      prevPortForwardsRef.current = new Map(portForwards)
      return
    }
    
    // 로딩 플래그 설정
    setIsLoadingNamespaces(true)
    
    // context별로 그룹화하여 한 번에 로드 (중복 방지)
    const contextNamespacesMap = new Map<string, Set<string>>()
    for (const { context, namespace } of namespacesToLoad) {
      if (!contextNamespacesMap.has(context)) {
        contextNamespacesMap.set(context, new Set())
      }
      contextNamespacesMap.get(context)!.add(namespace)
    }
    
    // 각 context에 대해 한 번만 로드 (중복 방지)
    const loadPromises: Promise<void>[] = []
    for (const [context, namespaceSet] of contextNamespacesMap.entries()) {
      // 이미 로딩 중인 context는 건너뛰기
      if (loadingContextRef.current.has(context)) {
        continue
      }
      
      const namespaceArray = Array.from(namespaceSet)
      // 이미 로드된 namespace 필터링 (최신 상태 확인)
      const namespacesToLoadForContext = namespaceArray.filter(namespace => {
        const namespaceKey = `${context}:${namespace}`
        // 이미 로드된 namespace는 건너뛰기
        if (loadedNamespacesRef.current.has(namespaceKey)) {
          return false
        }
        
        const existingPods = currentPodsByNamespace.get(namespace)
        const contextServices = currentServicesByContextAndNamespace.get(context)
        const existingServices = contextServices?.get(namespace) || []
        return !existingPods || existingPods.length === 0 || existingServices.length === 0
      })
      
      if (namespacesToLoadForContext.length > 0) {
        // 로드 시작 시간 기록
        lastLoadTimeRef.current.set(context, Date.now())
        
        // ref를 통해 loadPodsForNamespaces 호출 (무한 루프 방지)
        const loadFn = loadPodsForNamespacesRef.current
        if (!loadFn) {
          console.error('[App] loadPodsForNamespaces is not available')
          continue
        }
        
        loadPromises.push(
          loadFn(context, namespacesToLoadForContext, false)
            .then(() => {
              // 로드 완료 후 추적에 추가
              namespacesToLoadForContext.forEach(namespace => {
                const namespaceKey = `${context}:${namespace}`
                loadedNamespacesRef.current.add(namespaceKey)
              })
            })
            .catch(error => {
              console.error(`Failed to load namespaces for context ${context}:`, error)
            })
        )
      }
    }
    
    // 모든 로드 완료 후 플래그 해제
    Promise.all(loadPromises).finally(() => {
      setIsLoadingNamespaces(false)
    })
    
    // 이전 상태 업데이트 (다음 체크를 위해)
    prevPortForwardsRef.current = new Map(portForwards)
  }, [portForwards, allForwarding, isLoadingNamespaces, lastAllForwardTime])

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

  // 모든 context의 모든 Service 목록
  const currentServices = React.useMemo(() => {
    const allServices: Array<Service & { context?: string }> = []
    const serviceSet = new Set<string>() // 중복 방지용 (context:namespace:service)
    
    // 모든 context의 모든 namespace의 services 포함
    for (const [context, contextServices] of servicesByContextAndNamespace.entries()) {
      for (const [namespace, services] of contextServices.entries()) {
        for (const service of services) {
          const key = `${context}:${namespace}:${service.name}`
          if (!serviceSet.has(key)) {
            serviceSet.add(key)
            allServices.push({ ...service, context })
          }
        }
      }
    }
    
    return allServices
  }, [servicesByContextAndNamespace])

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

  // 특정 context의 모든 활성 포트포워딩 비활성화
  const handleDisableContextPortForwards = useCallback(async (context: string) => {
    const contextMap = portForwards.get(context)
    if (!contextMap) return

    const activePortForwardsList: Array<{
      context: string
      namespace: string
      podName: string
      remotePort: number
      localPort: number
    }> = []

    // 해당 context의 모든 활성 포트포워딩 수집
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

    // 각 포트포워딩을 순차적으로 비활성화
    for (const item of activePortForwardsList) {
      try {
        // 포트포워딩 정보에서 config 찾기
        const itemContextMap = portForwards.get(item.context)
        const namespaceMap = itemContextMap?.get(item.namespace)
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
  }, [portForwards, stopPortForward])

  // Context 토글: 포트포워딩 시작 또는 해제
  const handleContextToggle = useCallback(async (context: string) => {
    // 해당 context에 활성 포트포워딩이 있는지 확인
    const contextMap = portForwards.get(context)
    let hasActiveForwards = false
    
    if (contextMap) {
      for (const namespaceMap of contextMap.values()) {
        for (const podMap of namespaceMap.values()) {
          for (const config of podMap.values()) {
            if (config.active) {
              hasActiveForwards = true
              break
            }
          }
          if (hasActiveForwards) break
        }
        if (hasActiveForwards) break
      }
    }

    if (hasActiveForwards) {
      // 해제
      await handleDisableContextPortForwards(context)
    } else {
      // 포트포워딩 시작
      await handleAllForward(context)
    }
  }, [portForwards, handleAllForward, handleDisableContextPortForwards])

  // 모든 활성 포트포워딩 비활성화
  const handleDisableAllPortForwards = useCallback(async () => {
    // 이미 진행 중이면 무시
    if (disablingAll) {
      return
    }

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

    if (activePortForwardsList.length === 0) {
      return
    }

    setDisablingAll(true)

    try {
      // 각 포트포워딩을 순차적으로 비활성화
      for (let i = 0; i < activePortForwardsList.length; i++) {
        const item = activePortForwardsList[i]
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
    } finally {
      setDisablingAll(false)
    }
  }, [portForwards, activeContext, handleContextChange, stopPortForward, disablingAll])

  // GNB용 새로고침 핸들러
  const handleRefreshForGNB = useCallback(async () => {
    setRefreshing(true)
    try {
      // 1. 모든 포트포워딩 해제
      await handleDisableAllPortForwards()
      
      // 2. 캐시 비우기
      clearCache()
      
      // 3. 모든 context 다시 로드
      const loadedContexts = await fetchContexts()
      setContexts(loadedContexts)
      
      // 4. 모든 context의 모든 namespace 다시 로드
      for (const context of loadedContexts) {
        try {
          const namespaces = await fetchNamespaces(context.name)
          if (namespaces && namespaces.length > 0) {
            // 제외할 namespace 필터링
            const availableNamespaces = namespaces
              .filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
              .map(ns => ns.name)
            
            if (availableNamespaces.length > 0) {
              // namespacesByContext 업데이트
              setNamespacesByContext(prev => {
                const newMap = new Map(prev)
                newMap.set(context.name, namespaces)
                return newMap
              })
              
              // 모든 namespace의 pod와 service 로드
              const loadFn = loadPodsForNamespacesRef.current
              if (loadFn) {
                await loadFn(context.name, availableNamespaces, false)
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load data for context ${context.name}:`, error)
        }
      }
    } catch (error) {
      console.error('Failed to refresh:', error)
    } finally {
      setRefreshing(false)
    }
  }, [handleDisableAllPortForwards, clearCache, fetchContexts, fetchNamespaces])

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
        contexts={contexts}
        onAllForward={handleAllForward}
        allForwarding={allForwarding}
        allForwardProgress={allForwardProgress}
        onDisableAllPortForwards={handleDisableAllPortForwards}
        onContextToggle={handleContextToggle}
        portForwards={portForwards}
      />
      <div className="app-content" style={{ position: 'relative' }}>
        <div className="main-content">
          {/* all forward 진행 중 전체 화면 로딩 오버레이 */}
          {allForwarding.size > 0 && (
            <div className="all-forward-overlay">
              <div className="all-forward-loading">
                <div className="all-forward-spinner"></div>
                <h3>Forwarding all services...</h3>
                <p>
                  {(() => {
                    const contexts = Array.from(allForwarding)
                    const progress = contexts.map(ctx => {
                      const prog = allForwardProgress.get(ctx)
                      return prog ? `${prog.current}/${prog.total}` : 'processing...'
                    })
                    return progress.join(', ')
                  })()}
                </p>
                <p className="all-forward-note">Please wait until all services are forwarded...</p>
              </div>
            </div>
          )}
          {/* disable all 진행 중 전체 화면 로딩 오버레이 */}
          {disablingAll && (
            <div className="all-forward-overlay">
              <div className="all-forward-loading">
                <div className="all-forward-spinner"></div>
                <h3>Disabling all port forwards...</h3>
                <p className="all-forward-note">Please wait until all port forwards are disabled...</p>
              </div>
            </div>
          )}
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
              portForwards={portForwards}
              services={currentServices}
              onPortForwardChange={handlePortForwardChange}
            />
          )}
        </div>
      </div>
      {/* 알림 표시 */}
      {notification && (
        <Notification
          successCount={notification.successCount}
          failCount={notification.failCount}
          onClose={() => setNotification(null)}
        />
      )}
    </div>
  )
}

export default App


