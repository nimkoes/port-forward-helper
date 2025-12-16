/**
 * 도메인을 생성합니다.
 * 형식: deployment.namespace.context (중복 방지를 위해 컨텍스트 포함)
 */
export function generateDomain(deployment: string, namespace: string, context: string): string {
  return `${deployment}.${namespace}.${context}`
}

/**
 * 도메인을 표시용으로 포맷합니다.
 * 컨텍스트를 제외한 형식으로 반환합니다.
 */
export function formatDomainForDisplay(domain: string): string {
  // deployment.namespace.context 형식에서 마지막 .context 제거
  const parts = domain.split('.')
  if (parts.length > 2) {
    // 마지막 부분(컨텍스트) 제거
    return parts.slice(0, -1).join('.')
  }
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

