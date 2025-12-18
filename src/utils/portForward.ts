import type { PortForwardConfig } from '@/types'

/**
 * 포트포워딩 맵에서 활성 포트포워딩이 있는지 확인합니다.
 * @param podMap Pod별 포트포워딩 맵 (Map<remotePort, PortForwardConfig>)
 * @returns 활성 포트포워딩이 있는지 여부
 */
export function hasActivePortForward(podMap: Map<number, PortForwardConfig>): boolean {
  return Array.from(podMap.values()).some(pf => pf.active)
}

/**
 * 모든 활성 포트포워딩의 로컬 포트 목록을 수집합니다.
 * @param portForwards 전체 포트포워딩 맵 (Map<context, Map<namespace, Map<podName, Map<remotePort, PortForwardConfig>>>>)
 * @returns 활성 포트포워딩의 로컬 포트 Set
 */
export function getActiveLocalPorts(
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
): Set<number> {
  const ports = new Set<number>()
  for (const [, contextMap] of portForwards.entries()) {
    for (const [, namespaceMap] of contextMap.entries()) {
      for (const [, podMap] of namespaceMap.entries()) {
        for (const [, config] of podMap.entries()) {
          if (config.active) {
            ports.add(config.localPort)
          }
        }
      }
    }
  }
  return ports
}

/**
 * 모든 활성 포트포워딩 설정을 수집합니다.
 * @param portForwards 전체 포트포워딩 맵 (Map<context, Map<namespace, Map<podName, Map<remotePort, PortForwardConfig>>>>)
 * @returns 활성 포트포워딩 설정 배열
 */
export function getActivePortForwards(
  portForwards: Map<string, Map<string, Map<string, Map<number, PortForwardConfig>>>>
): PortForwardConfig[] {
  const activeForwards: PortForwardConfig[] = []
  for (const [, contextMap] of portForwards.entries()) {
    for (const [, namespaceMap] of contextMap.entries()) {
      for (const [, podMap] of namespaceMap.entries()) {
        for (const [, config] of podMap.entries()) {
          if (config.active) {
            activeForwards.push(config)
          }
        }
      }
    }
  }
  return activeForwards
}

/**
 * 포트포워딩 맵에서 활성 포트포워딩을 찾습니다.
 * @param podMap Pod별 포트포워딩 맵 (Map<remotePort, PortForwardConfig>)
 * @returns 활성 포트포워딩 또는 undefined
 */
export function findActivePortForward(podMap: Map<number, PortForwardConfig>): PortForwardConfig | undefined {
  return Array.from(podMap.values()).find(pf => pf.active)
}

/**
 * 포트포워딩 맵에서 특정 포트의 활성 포트포워딩을 찾습니다.
 * @param podMap Pod별 포트포워딩 맵 (Map<remotePort, PortForwardConfig>)
 * @param remotePort 원격 포트 번호
 * @returns 활성 포트포워딩 또는 undefined
 */
export function findActivePortForwardByPort(
  podMap: Map<number, PortForwardConfig>,
  remotePort: number
): PortForwardConfig | undefined {
  const config = podMap.get(remotePort)
  return config && config.active ? config : undefined
}

