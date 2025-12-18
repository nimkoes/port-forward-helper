/**
 * Kubernetes 리소스의 생성 시간으로부터 경과 시간을 계산합니다.
 * @param creationTimestamp 생성 시간 (ISO 8601 형식)
 * @returns 경과 시간 문자열 (예: "5d", "3h", "30m", "45s")
 */
export function calculateAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return 'Unknown'

  try {
    const created = new Date(creationTimestamp).getTime()
    const now = Date.now()
    const diffMs = now - created
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays}d`
    if (diffHours > 0) return `${diffHours}h`
    if (diffMins > 0) return `${diffMins}m`
    return `${diffSecs}s`
  } catch {
    return 'Unknown'
  }
}

