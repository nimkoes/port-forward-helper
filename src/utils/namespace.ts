import { EXCLUDED_NAMESPACES } from '@/constants/namespaces'
import type { Namespace } from '@/types'

/**
 * 제외할 namespace를 필터링합니다.
 * @param namespaces 필터링할 namespace 목록
 * @returns 필터링된 namespace 목록
 */
export function filterExcludedNamespaces(namespaces: Namespace[]): Namespace[] {
  return namespaces.filter(ns => !EXCLUDED_NAMESPACES.includes(ns.name))
}

/**
 * namespace 이름 배열에서 제외할 namespace를 필터링합니다.
 * @param namespaceNames 필터링할 namespace 이름 배열
 * @returns 필터링된 namespace 이름 배열
 */
export function filterExcludedNamespaceNames(namespaceNames: string[]): string[] {
  return namespaceNames.filter(ns => ns && ns.trim() !== '' && !EXCLUDED_NAMESPACES.includes(ns))
}

