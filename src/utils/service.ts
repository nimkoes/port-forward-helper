import type { Service, Pod } from '@/types'

/**
 * Service 포트가 HTTP 포트인지 확인합니다.
 * @param servicePort Service 포트 정보
 * @returns HTTP 포트인지 여부
 */
export function isHttpServicePort(servicePort: Service['ports'][0]): boolean {
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
}

/**
 * Service의 selector로 매칭되는 Pod 목록을 찾습니다.
 * @param service Service 정보
 * @param pods Pod 목록
 * @param excludeFailed 실패한 Pod를 제외할지 여부 (기본값: true)
 * @returns 매칭되는 Pod 목록
 */
export function findMatchingPods(
  service: Service,
  pods: Pod[],
  excludeFailed: boolean = true
): Pod[] {
  if (!service.selector) {
    return []
  }

  const matchingPods: Pod[] = []
  for (const pod of pods) {
    if (!pod.labels) continue
    if (excludeFailed && pod.status.toLowerCase() === 'failed') continue

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

  return matchingPods
}

