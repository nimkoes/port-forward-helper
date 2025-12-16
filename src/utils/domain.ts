/**
 * 도메인을 생성합니다.
 * 형식: deployment.namespace (context 제외)
 */
export function generateDomain(deployment: string, namespace: string): string {
  return `${deployment}.${namespace}`
}

/**
 * 도메인을 표시용으로 포맷합니다.
 * 현재는 도메인이 이미 context를 포함하지 않으므로 그대로 반환합니다.
 */
export function formatDomainForDisplay(domain: string): string {
  return domain
}

/**
 * 도메인 유효성 검사
 */
export function isValidDomain(domain: string): boolean {
  // 기본적인 도메인 형식 검사
  const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
  return domainRegex.test(domain) && domain.length <= 253
}

/**
 * Service URL을 생성합니다.
 * target-port가 80이면 포트 없이, 아니면 포트 포함
 * @param serviceName Service 이름
 * @param namespace 네임스페이스
 * @param targetPort target port (숫자 또는 문자열)
 * @returns Service URL (예: "my-service.ov" 또는 "my-service.ov:9090")
 */
export function generateServiceUrl(serviceName: string, namespace: string, targetPort: number | string): string {
  const baseUrl = `${serviceName}.${namespace}`
  
  // targetPort를 숫자로 변환 시도
  const portNumber = typeof targetPort === 'string' ? parseInt(targetPort, 10) : targetPort
  
  // 포트가 80이 아니고 유효한 숫자인 경우에만 포트 추가
  if (!isNaN(portNumber) && portNumber !== 80) {
    return `${baseUrl}:${portNumber}`
  }
  
  return baseUrl
}

/**
 * Service URL에서 hosts 파일용 도메인을 추출합니다 (포트 제거)
 * @param serviceUrl Service URL (예: "my-service.ov:9090")
 * @returns hosts 파일용 도메인 (예: "my-service.ov")
 */
export function extractHostsDomain(serviceUrl: string): string {
  const colonIndex = serviceUrl.indexOf(':')
  if (colonIndex > 0) {
    return serviceUrl.substring(0, colonIndex)
  }
  return serviceUrl
}

