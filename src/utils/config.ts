/**
 * 애플리케이션 설정 유틸리티
 * 환경 변수에서 설정을 읽어옵니다.
 */

/**
 * 네임스페이스별 기본 포트를 반환합니다.
 * 환경 변수 VITE_ALLOWED_NAMESPACES에서 읽어오며, namespace:port 형식을 지원합니다.
 * 예: "ov:9090,api:8080,backend" -> Map { "ov" => 9090, "api" => 8080 }
 * 환경 변수가 설정되지 않은 경우 빈 Map을 반환합니다.
 */
export function getNamespaceDefaultPorts(): Map<string, number> {
  const envValue = import.meta.env.VITE_ALLOWED_NAMESPACES
  
  if (!envValue || typeof envValue !== 'string') {
    console.warn('[getNamespaceDefaultPorts] VITE_ALLOWED_NAMESPACES가 설정되지 않았습니다.')
    return new Map<string, number>()
  }

  console.log('[getNamespaceDefaultPorts] 환경 변수 값:', envValue)

  const portMap = new Map<string, number>()
  
  // 쉼표로 구분된 문자열을 배열로 변환하고, 공백 제거
  const items = envValue
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)

  // 각 항목에서 네임스페이스와 포트 추출
  for (const item of items) {
    const colonIndex = item.indexOf(':')
    if (colonIndex > 0) {
      // namespace:port 형식
      const namespace = item.substring(0, colonIndex).trim()
      const portStr = item.substring(colonIndex + 1).trim()
      const port = parseInt(portStr, 10)
      
      if (namespace.length > 0 && !isNaN(port) && port > 0 && port <= 65535) {
        portMap.set(namespace, port)
        console.log(`[getNamespaceDefaultPorts] 네임스페이스 "${namespace}"의 기본 포트: ${port}`)
      } else {
        console.warn(`[getNamespaceDefaultPorts] 잘못된 포트 형식: ${item} (namespace: ${namespace}, port: ${portStr})`)
      }
    }
    // 콜론이 없으면 포트 없음 (무시)
  }

  console.log('[getNamespaceDefaultPorts] 최종 포트 맵:', Array.from(portMap.entries()))
  return portMap
}

/**
 * 허용된 네임스페이스 목록을 반환합니다.
 * 환경 변수 VITE_ALLOWED_NAMESPACES에서 읽어오며, 쉼표로 구분된 문자열입니다.
 * namespace:port 형식도 지원하며, 이 경우 네임스페이스만 추출합니다.
 * 환경 변수가 설정되지 않은 경우 빈 Set을 반환합니다.
 */
export function getAllowedNamespaces(): Set<string> {
  const envValue = import.meta.env.VITE_ALLOWED_NAMESPACES
  
  if (!envValue || typeof envValue !== 'string') {
    console.warn('VITE_ALLOWED_NAMESPACES가 설정되지 않았습니다. .env 파일을 확인하세요.')
    return new Set<string>()
  }

  const namespaces = new Set<string>()
  
  // 쉼표로 구분된 문자열을 배열로 변환하고, 공백 제거
  const items = envValue
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0)

  // 각 항목에서 네임스페이스 추출 (namespace:port 형식에서도 네임스페이스만 추출)
  for (const item of items) {
    const colonIndex = item.indexOf(':')
    if (colonIndex > 0) {
      // namespace:port 형식 - 네임스페이스만 추출
      const namespace = item.substring(0, colonIndex).trim()
      if (namespace.length > 0) {
        namespaces.add(namespace)
      }
    } else {
      // namespace만 있는 형식
      if (item.length > 0) {
        namespaces.add(item)
      }
    }
  }

  return namespaces
}

